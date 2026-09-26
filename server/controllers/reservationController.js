const Reservation = require("../models/Reservation");
const BranchInventory = require("../models/BranchInventory");
const Branch = require("../models/Branch");
const Product = require("../models/Product");
const InventoryTransaction = require("../models/InventoryTransaction");
const { fail, positiveQuantity, runTransaction, sendStockError } = require("../lib/stockOperations");
const {
  branchFilter,
  canAccessBranch,
  getAssignedBranchId,
  isSuperAdmin,
} = require("../lib/branchAccess");

const generateReservationNumber = async () => {
  const count = await Reservation.countDocuments();
  return `RES-${String(count + 1).padStart(6, "0")}`;
};

const releaseExpiredReservations = async (branchId = null) => {
  const expired = await Reservation.find({
    status: { $in: ["ACTIVE", "READY_FOR_PICKUP"] },
    expiresAt: { $lte: new Date() },
    ...(branchId ? { branch: branchId } : {}),
  }).select("_id branch product quantity");

  for (const reservation of expired) {
    await runTransaction(async (session) => {
      const released = await Reservation.findOneAndUpdate(
        {
          _id: reservation._id,
          status: { $in: ["ACTIVE", "READY_FOR_PICKUP"] },
          expiresAt: { $lte: new Date() },
        },
        { $set: { status: "EXPIRED" } },
        { new: true, session },
      );
      if (!released) return;
      const inventory = await BranchInventory.findOneAndUpdate(
        {
          branch: released.branch,
          product: released.product,
          reservedQuantity: { $gte: released.quantity },
        },
        { $inc: { reservedQuantity: -released.quantity } },
        { new: true, session },
      );
      if (!inventory) fail(409, "Reservation hold could not be released.");
    });
  }
};

const reservationQuery = (req) => {
  const query = {};
  if (isSuperAdmin(req.user)) {
    if (req.query.branch) query.branch = req.query.branch;
  } else {
    query.branch = getAssignedBranchId(req.user);
  }
  if (req.query.status) query.status = req.query.status;
  return query;
};

const getReservations = async (req, res) => {
  try {
    if (
      !isSuperAdmin(req.user) &&
      req.query.branch &&
      !canAccessBranch(req.user, req.query.branch)
    ) {
      return res.status(403).json({ message: "You do not have access to this branch." });
    }

    const query = reservationQuery(req);
    await releaseExpiredReservations(query.branch);
    const reservations = await Reservation.find(query)
      .populate("branch", "name code")
      .populate("product", "name sku barcode unit sellingPrice")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });
    res.json(reservations);
  } catch (error) {
    res.status(500).json({ message: "Failed to get reservations." });
  }
};

const createReservation = async (req, res) => {
  try {
    const { branch, product, quantity, customerName, customerPhone, expiresAt } = req.body || {};
    if (!branch || !product || !customerName) {
      fail(400, "Branch, product, customer name, and quantity are required.");
    }
    const reservationQuantity = positiveQuantity(quantity, "Reservation quantity must be greater than zero.");
    if (reservationQuantity < 1) fail(400, "Reservation quantity must be at least one unit.");
    const expiry = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + 2 * 60 * 60 * 1000);
    if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
      fail(400, "Reservation expiry must be in the future.");
    }

    const [branchExists, productExists] = await Promise.all([
      Branch.findOne({ _id: branch, isActive: true }),
      Product.findOne({ _id: product, isActive: true }),
    ]);
    if (!branchExists || !productExists) {
      fail(404, "Active branch or product not found.");
    }

    await releaseExpiredReservations(branch);
    const reservation = await runTransaction(async (session) => {
      const inventory = await BranchInventory.findOneAndUpdate(
        {
          branch,
          product,
          $expr: {
            $gte: [
              { $subtract: ["$quantity", { $ifNull: ["$reservedQuantity", 0] }] },
              reservationQuantity,
            ],
          },
        },
        { $inc: { reservedQuantity: reservationQuantity } },
        { new: true, session },
      );
      if (!inventory) fail(409, "Not enough available stock at this branch.");
      const [created] = await Reservation.create([{
        reservationNumber: await generateReservationNumber(),
        branch,
        product,
        quantity: reservationQuantity,
        customerName,
        customerPhone,
        expiresAt: expiry,
        createdBy: req.user._id,
      }], { session });
      return created;
    });
    const populated = await Reservation.findById(reservation._id)
      .populate("branch", "name code")
      .populate("product", "name sku barcode unit sellingPrice");
    res.status(201).json(populated);
  } catch (error) {
    sendStockError(res, error, "Create reservation");
  }
};

const updateReservationStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!["READY_FOR_PICKUP", "COMPLETED", "CANCELLED"].includes(status)) {
      fail(400, "Invalid reservation status.");
    }

    const filter = { _id: req.params.id, ...branchFilter(req.user) };
    const existing = await Reservation.findOne(filter);
    if (!existing) fail(404, "Reservation not found.");
    await releaseExpiredReservations(existing.branch);

    const reservation = await runTransaction(async (session) => {
      const current = await Reservation.findOne(filter).session(session);
      if (!current) fail(404, "Reservation not found.");
      if (!["ACTIVE", "READY_FOR_PICKUP"].includes(current.status)) {
        fail(409, "Reservation is no longer active.");
      }

      if (status === "COMPLETED") {
        const inventory = await BranchInventory.findOneAndUpdate(
          {
            branch: current.branch,
            product: current.product,
            quantity: { $gte: current.quantity },
            reservedQuantity: { $gte: current.quantity },
          },
          { $inc: { quantity: -current.quantity, reservedQuantity: -current.quantity } },
          { new: true, session },
        );
        if (!inventory) fail(409, "Inventory cannot fulfill this reservation.");
        await InventoryTransaction.create([{
          product: current.product,
          branch: current.branch,
          type: "STOCK_OUT",
          quantity: current.quantity,
          previousQuantity: inventory.quantity + current.quantity,
          newQuantity: inventory.quantity,
          reason: "Reservation pickup",
          reference: current.reservationNumber,
          performedBy: req.user._id,
        }], { session });
      } else if (status === "CANCELLED") {
        const inventory = await BranchInventory.findOneAndUpdate(
          {
            branch: current.branch,
            product: current.product,
            reservedQuantity: { $gte: current.quantity },
          },
          { $inc: { reservedQuantity: -current.quantity } },
          { new: true, session },
        );
        if (!inventory) fail(409, "Reservation hold could not be released.");
      }

      current.status = status;
      current.completedAt = status === "COMPLETED" ? new Date() : undefined;
      await current.save({ session });
      return current;
    });
    res.json(reservation);
  } catch (error) {
    sendStockError(res, error, "Update reservation");
  }
};

module.exports = {
  getReservations,
  createReservation,
  updateReservationStatus,
};
