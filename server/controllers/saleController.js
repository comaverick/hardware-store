const mongoose = require("mongoose");

const Sale = require("../models/Sale");

const Branch = require("../models/Branch");

const Product = require("../models/Product");

const BranchInventory = require("../models/BranchInventory");

const InventoryTransaction = require("../models/InventoryTransaction");
const User = require("../models/User");
const bcrypt = require("bcryptjs");

const refundSale = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const saleFilter = {
      _id: req.params.id,
      ...(req.user?.role === "SUPER_ADMIN" ? {} : { branch: req.user?.branch?._id }),
    };
    const sale = await Sale.findOne(saleFilter).session(session);
    if (!sale) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Sale not found." });
    }
    if (!["COMPLETED", "PARTIALLY_REFUNDED"].includes(sale.status)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "This sale cannot be refunded." });
    }

    const privilegedRoles = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
    let approver = privilegedRoles.includes(req.user?.role) ? req.user : null;
    if (!approver) {
      const approvalPin = String(req.body?.approvalPin || "");
      if (!/^\d{4,6}$/.test(approvalPin)) {
        await session.abortTransaction();
        return res.status(400).json({ message: "A valid 4 to 6 digit manager PIN is required." });
      }
      const approvers = await User.find({
        role: { $in: privilegedRoles },
        isActive: true,
        $or: [{ role: "SUPER_ADMIN" }, { branch: req.user?.branch?._id }],
      }).select("+refundPin name role branch").lean();
      for (const candidate of approvers) {
        if (candidate.refundPin && await bcrypt.compare(approvalPin, candidate.refundPin)) {
          approver = candidate;
          break;
        }
      }
      if (!approver) {
        await session.abortTransaction();
        return res.status(403).json({ message: "The manager PIN is incorrect or not configured." });
      }
    }

    const reason = String(req.body?.reason || "").trim();
    const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!reason) {
      await session.abortTransaction();
      return res.status(400).json({ message: "A refund reason is required." });
    }
    if (!requestedItems.length) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Select at least one item to return." });
    }

    const discountFactor = sale.subtotal > 0 ? sale.totalAmount / sale.subtotal : 1;
    const refundItems = [];
    let refundAmount = 0;
    for (const requested of requestedItems) {
      const saleItem = sale.items.find((item) => String(item.product) === String(requested.product));
      const quantity = Number(requested.quantity);
      if (!saleItem || !Number.isInteger(quantity) || quantity < 1) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Each returned item must belong to the sale and have a valid quantity." });
      }
      const remaining = saleItem.quantity - (saleItem.refundedQuantity || 0);
      if (quantity > remaining) {
        await session.abortTransaction();
        return res.status(400).json({ message: `Cannot return more than the remaining quantity for an item. Remaining: ${remaining}.` });
      }
      const amount = Number((saleItem.unitPrice * quantity * discountFactor).toFixed(2));
      refundItems.push({ product: saleItem.product, quantity, amount });
      refundAmount += amount;
    }

    for (const item of refundItems) {
      const saleItem = sale.items.find((saleLine) => String(saleLine.product) === String(item.product));
      saleItem.refundedQuantity = (saleItem.refundedQuantity || 0) + item.quantity;
      const inventory = await BranchInventory.findOne({ branch: sale.branch, product: item.product }).session(session);
      if (!inventory) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Inventory record not found for a returned product." });
      }
      const previousQuantity = inventory.quantity || 0;
      inventory.quantity = previousQuantity + item.quantity;
      await inventory.save({ session });
      await InventoryTransaction.create([{
        product: item.product,
        branch: sale.branch,
        type: "STOCK_IN",
        quantity: item.quantity,
        previousQuantity,
        newQuantity: inventory.quantity,
        reason: "Customer return",
        reference: sale.receiptNumber,
        performedBy: req.user._id,
        notes: reason,
      }], { session });
    }

    sale.refundedAmount = Number(((sale.refundedAmount || 0) + refundAmount).toFixed(2));
    sale.refunds.push({ refundedBy: req.user._id, approvedBy: approver._id, amount: refundAmount, reason, items: refundItems });
    const fullyRefunded = sale.items.every((item) => (item.refundedQuantity || 0) >= item.quantity);
    sale.status = fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await sale.save({ session });
    await session.commitTransaction();

    const populatedSale = await Sale.findById(sale._id)
      .populate("branch", "name code")
      .populate("cashier", "name email role")
      .populate("items.product", "name sku barcode unit sellingPrice")
      .populate("refunds.refundedBy", "name email role")
      .populate("refunds.approvedBy", "name email role")
      .lean();
    res.json({ message: "Refund processed successfully.", refundAmount, sale: populatedSale });
  } catch (error) {
    await session.abortTransaction();
    console.error("Refund sale error:", error);
    res.status(500).json({ message: "Failed to process refund." });
  } finally {
    session.endSession();
  }
};

// =========================
// GENERATE RECEIPT NUMBER
// =========================

const generateReceiptNumber = async () => {
  const count = await Sale.countDocuments();

  const number = String(count + 1).padStart(6, "0");

  return `SALE-${number}`;
};

// =========================
// CREATE SALE
// =========================

const createSale = async (req, res) => {
  const session = await mongoose.startSession();

  session.startTransaction();

  try {
    const { branch, items, discount = 0, paymentMethod, amountPaid } = req.body;

    // =========================
    // BASIC VALIDATION
    // =========================

    if (!branch) {
      return res.status(400).json({
        message: "Branch is required.",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "Sale must contain at least one item.",
      });
    }

    if (!paymentMethod) {
      return res.status(400).json({
        message: "Payment method is required.",
      });
    }

    if (amountPaid === undefined || amountPaid === null) {
      return res.status(400).json({
        message: "Amount paid is required.",
      });
    }

    // =========================
    // CHECK BRANCH
    // =========================

    const branchData = await Branch.findById(branch).session(session);

    if (!branchData || !branchData.isActive) {
      return res.status(400).json({
        message: "Branch does not exist or is inactive.",
      });
    }

    // =========================
    // PREPARE ITEMS
    // =========================

    let subtotal = 0;

    const saleItems = [];

    for (const item of items) {
      if (!item.product || !item.quantity) {
        return res.status(400).json({
          message: "Each sale item requires a product and quantity.",
        });
      }

      const quantity = Number(item.quantity);

      if (quantity <= 0) {
        return res.status(400).json({
          message: "Quantity must be greater than zero.",
        });
      }

      const product = await Product.findById(item.product).session(session);

      if (!product || !product.isActive) {
        return res.status(400).json({
          message:
            "One of the selected products does not exist or is inactive.",
        });
      }

      // =========================
      // CHECK INVENTORY
      // =========================

      const inventory = await BranchInventory.findOne({
        branch,
        product: item.product,
      }).session(session);

      if (!inventory) {
        return res.status(400).json({
          message: `${product.name} is not available in this branch.`,
        });
      }

      const availableQuantity =
        inventory.quantity - (inventory.reservedQuantity || 0);

      if (availableQuantity < quantity) {
        return res.status(400).json({
          message: `Insufficient available stock for ${product.name}. Available: ${availableQuantity}.`,
        });
      }

      const unitPrice = Number(product.sellingPrice);

      const itemSubtotal = unitPrice * quantity;

      subtotal += itemSubtotal;

      saleItems.push({
        product: product._id,

        quantity,

        unitPrice,

        subtotal: itemSubtotal,
      });
    }

    // =========================
    // CALCULATE TOTAL
    // =========================

    const discountAmount = Number(discount) || 0;

    if (discountAmount < 0 || discountAmount > subtotal) {
      return res.status(400).json({
        message: "Invalid discount amount.",
      });
    }

    const totalAmount = subtotal - discountAmount;

    const paid = Number(amountPaid);

    if (paid < totalAmount) {
      return res.status(400).json({
        message: `Insufficient payment. Total is â‚±${totalAmount.toFixed(2)}.`,
      });
    }

    const changeAmount = paid - totalAmount;

    // =========================
    // RECEIPT NUMBER
    // =========================

    const receiptNumber = await generateReceiptNumber();

    // =========================
    // CREATE SALE
    // =========================

    const sale = new Sale({
      receiptNumber,

      branch,

      items: saleItems,

      subtotal,

      discount: discountAmount,

      totalAmount,

      paymentMethod,

      amountPaid: paid,

      changeAmount,

      status: "COMPLETED",

      cashier: req.user._id,
    });

    await sale.save({
      session,
    });

    // =========================
    // UPDATE INVENTORY
    // =========================

    for (const item of saleItems) {
      const inventory = await BranchInventory.findOne({
        branch,
        product: item.product,
      }).session(session);

      const previousQuantity = inventory.quantity;

      const newQuantity = previousQuantity - item.quantity;

      inventory.quantity = newQuantity;

      await inventory.save({
        session,
      });

      // =========================
      // STOCK OUT TRANSACTION
      // =========================

      await InventoryTransaction.create(
        [
          {
            product: item.product,

            branch,

            type: "STOCK_OUT",

            quantity: item.quantity,

            previousQuantity,

            newQuantity,

            reason: "POS Sale",

            reference: receiptNumber,

            performedBy: req.user._id,

            notes: "Inventory released through POS sale.",
          },
        ],
        {
          session,
        },
      );
    }

    await session.commitTransaction();

    const populatedSale = await Sale.findById(sale._id)
      .populate("branch", "name code")
      .populate("cashier", "name email role")
      .populate("items.product", "name sku barcode unit sellingPrice");

    res.status(201).json({
      message: "Sale completed successfully.",

      sale: populatedSale,
    });
  } catch (error) {
    await session.abortTransaction();

    console.error("Create sale error:", error);

    res.status(500).json({
      message: "Failed to complete sale.",
    });
  } finally {
    session.endSession();
  }
};

// =========================
// GET SALES
// =========================

const getSales = async (req, res) => {
  try {
    const privilegedRoles = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
    const canViewBranchHistory = privilegedRoles.includes(req.user?.role);
    const salesFilter = canViewBranchHistory
      ? (req.user?.role === "SUPER_ADMIN"
        ? {}
        : { branch: req.user?.branch?._id })
      : {
          cashier: req.user?._id,
          ...(req.user?.branch?._id ? { branch: req.user.branch._id } : {}),
        };

    const sales = await Sale.find(salesFilter)
      .populate("branch", "name code")
      .populate("cashier", "name email role")
      .populate("items.product", "name sku barcode unit costPrice sellingPrice")
      .sort({
        createdAt: -1,
      });

    res.json(sales);
  } catch (error) {
    console.error("Get sales error:", error);

    res.status(500).json({
      message: "Failed to retrieve sales.",
    });
  }
};

// GET ONE SALE
// =========================

const getSaleById = async (req, res) => {
  try {
    const privilegedRoles = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
    const canViewBranchHistory = privilegedRoles.includes(req.user?.role);
    const saleFilter = {
      _id: req.params.id,
      ...(canViewBranchHistory && req.user?.role !== "SUPER_ADMIN"
        ? { branch: req.user?.branch?._id }
        : {}),
      ...(!canViewBranchHistory ? { cashier: req.user?._id } : {}),
    };

    const sale = await Sale.findOne(saleFilter)
      .populate("branch", "name code")
      .populate("cashier", "name email role")
      .populate("items.product", "name sku barcode unit sellingPrice");

    if (!sale) {
      return res.status(404).json({
        message: "Sale not found.",
      });
    }

    res.json(sale);
  } catch (error) {
    console.error("Get sale error:", error);

    res.status(500).json({
      message: "Failed to retrieve sale.",
    });
  }
};

module.exports = {
  createSale,
  getSales,
  getSaleById,
  refundSale,
};
