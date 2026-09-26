const crypto = require("node:crypto");
const mongoose = require("mongoose");

const Branch = require("../models/Branch");
const Product = require("../models/Product");
const Reservation = require("../models/Reservation");
const Sale = require("../models/Sale");
const BranchInventory = require("../models/BranchInventory");
const InventoryTransaction = require("../models/InventoryTransaction");
const { branchFilter } = require("../lib/branchAccess");
const { EXPIRABLE_STATUSES } = require("../lib/reservationExpiry");
const { fail, runStockOperation, sendStockError } = require("../lib/stockOperations");

const checkoutReservation = async (req, res) => {
  try {
    const { branch, items, discount = 0, paymentMethod, amountPaid } = req.body || {};
    if (!mongoose.isValidObjectId(req.params.id)) fail(400, "Invalid reservation ID.");
    if (!branch) fail(400, "Branch is required.");
    if (!mongoose.isValidObjectId(branch)) fail(400, "Invalid branch ID.");
    if (!Array.isArray(items) || !items.length) fail(400, "Sale must contain at least one item.");
    if (!["CASH", "GCASH", "CARD"].includes(paymentMethod)) fail(400, "Invalid payment method.");
    if (amountPaid === undefined || amountPaid === null || amountPaid === "") {
      fail(400, "Amount paid is required.");
    }

    // Build the unique reservation index before accepting a checkout.
    await Sale.init();
    const result = await runStockOperation(req, `reservation-checkout:${req.params.id}`, async (session) => {
      const reservation = await Reservation.findOne({
        _id: req.params.id,
        ...branchFilter(req.user),
      }).session(session);
      if (!reservation) fail(404, "Reservation not found in your branch.");
      if (String(reservation.branch) !== String(branch)) {
        fail(403, "Select the reservation's pickup branch.");
      }
      const now = new Date();
      if (!EXPIRABLE_STATUSES.includes(reservation.status) || new Date(reservation.expiresAt) <= now) {
        fail(409, "Reservation is expired or already completed.");
      }
      const branchData = await Branch.findOne({ _id: branch, isActive: true }).session(session);
      if (!branchData) fail(400, "Branch does not exist or is inactive.");

      const saleItems = [];
      const seenProducts = new Set();
      let subtotal = 0;
      let heldItemFound = false;
      for (const item of items) {
        const quantity = Number(item.quantity);
        if (!mongoose.isValidObjectId(item.product) || !Number.isFinite(quantity) || quantity < 1) {
          fail(400, "Each sale item requires a product and a quantity of at least one.");
        }
        const productId = String(item.product);
        if (seenProducts.has(productId)) fail(400, "Each product can appear only once in a sale.");
        seenProducts.add(productId);

        const product = await Product.findOne({ _id: item.product, isActive: true }).session(session);
        if (!product) fail(400, "One of the selected products is unavailable.");
        const held = productId === String(reservation.product);
        if (held) {
          heldItemFound = true;
          if (quantity !== reservation.quantity) {
            fail(400, "The reserved item's quantity must match the held quantity.");
          }
        }
        const unitPrice = Number(product.sellingPrice);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) fail(409, "Product price is invalid.");
        const itemSubtotal = Number((unitPrice * quantity).toFixed(2));
        subtotal += itemSubtotal;
        saleItems.push({ product: product._id, quantity, unitPrice, subtotal: itemSubtotal, held });
      }
      if (!heldItemFound) fail(400, "Add the reserved product to the sale.");

      const discountAmount = Number(discount);
      const paid = Number(amountPaid);
      if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > subtotal) {
        fail(400, "Invalid discount amount.");
      }
      const totalAmount = Number((subtotal - discountAmount).toFixed(2));
      if (!Number.isFinite(paid) || paid < totalAmount) {
        fail(400, `Insufficient payment. Total is ₱${totalAmount.toFixed(2)}.`);
      }

      const sale = new Sale({
        receiptNumber: `SALE-${Date.now()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
        reservation: reservation._id,
        branch,
        items: saleItems.map(({ held, ...item }) => item),
        subtotal: Number(subtotal.toFixed(2)),
        discount: discountAmount,
        totalAmount,
        paymentMethod,
        amountPaid: paid,
        changeAmount: Number((paid - totalAmount).toFixed(2)),
        status: "COMPLETED",
        cashier: req.user._id,
      });

      const claimed = await Reservation.findOneAndUpdate(
        {
          _id: reservation._id,
          branch,
          status: { $in: EXPIRABLE_STATUSES },
          expiresAt: { $gt: now },
          sale: { $exists: false },
        },
        { $set: { status: "COMPLETED", completedAt: now, sale: sale._id } },
        { new: true, session },
      );
      if (!claimed) fail(409, "Reservation changed or expired. Refresh and try again.");

      for (const item of saleItems) {
        const filter = item.held
          ? {
              branch,
              product: item.product,
              quantity: { $gte: item.quantity },
              reservedQuantity: { $gte: item.quantity },
            }
          : {
              branch,
              product: item.product,
              $expr: {
                $gte: [
                  { $subtract: ["$quantity", { $ifNull: ["$reservedQuantity", 0] }] },
                  item.quantity,
                ],
              },
            };
        const change = item.held
          ? { quantity: -item.quantity, reservedQuantity: -item.quantity }
          : { quantity: -item.quantity };
        const inventory = await BranchInventory.findOneAndUpdate(
          filter,
          { $inc: change },
          { new: true, session, runValidators: true },
        );
        if (!inventory) fail(409, "Stock changed. Refresh inventory and try again.");
        await InventoryTransaction.create([{
          product: item.product,
          branch,
          type: "STOCK_OUT",
          quantity: item.quantity,
          previousQuantity: inventory.quantity + item.quantity,
          newQuantity: inventory.quantity,
          reason: item.held ? "Reservation POS sale" : "POS Sale",
          reference: sale.receiptNumber,
          performedBy: req.user._id,
          notes: item.held ? `Reservation ${reservation.reservationNumber}` : "Inventory released through POS sale.",
        }], { session });
      }

      await sale.save({ session });
      const populatedSale = await Sale.findById(sale._id).session(session)
        .populate("branch", "name code")
        .populate("cashier", "name email role")
        .populate("items.product", "name sku barcode unit sellingPrice")
        .lean();
      return { status: 201, body: { message: "Reservation sale completed successfully.", sale: populatedSale } };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.reservation) {
      return res.status(409).json({ message: "Reservation has already been checked out." });
    }
    sendStockError(res, error, "Check out reservation");
  }
};

module.exports = { checkoutReservation };
