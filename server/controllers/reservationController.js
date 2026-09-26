const Reservation = require("../models/Reservation");
const BranchInventory = require("../models/BranchInventory");
const Branch = require("../models/Branch");
const Product = require("../models/Product");
const { fail, positiveQuantity, runTransaction, sendStockError } = require("../lib/stockOperations");
const { expireReservation, processExpiredReservations, EXPIRABLE_STATUSES } = require("../lib/reservationExpiry");
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
    const expiry = await processExpiredReservations({ branchId: query.branch, maxBatches: 2 });
    for (const error of expiry.errors) console.error("Reservation expiry error:", error);
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

    const expiryPass = await processExpiredReservations({ branchId: branch, maxBatches: 2 });
    for (const error of expiryPass.errors) console.error("Reservation expiry error:", error);
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

const lookupReservation = async (req, res) => {
  try {
    const number = String(req.query?.number || "").trim().toUpperCase();
    if (!/^RES-[A-Z0-9-]{1,40}$/.test(number)) {
      fail(400, "Enter a valid reservation number.");
    }
    const reservation = await Reservation.findOne({
      reservationNumber: number,
      ...branchFilter(req.user),
    })
      .populate("branch", "name code")
      .populate("product", "name sku unit sellingPrice isActive");
    if (!reservation) fail(404, "Reservation not found in your branch.");
    if (new Date(reservation.expiresAt) <= new Date()) {
      await expireReservation(reservation);
      fail(409, "This reservation has expired.");
    }
    if (!EXPIRABLE_STATUSES.includes(reservation.status)) {
      fail(409, "This reservation is no longer available for checkout.");
    }
    res.json(reservation);
  } catch (error) {
    sendStockError(res, error, "Find reservation");
  }
};

const updateReservationStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (status === "COMPLETED") {
      fail(400, "Complete reservations through POS checkout.");
    }
    if (!["READY_FOR_PICKUP", "CANCELLED"].includes(status)) {
      fail(400, "Invalid reservation status.");
    }

    const filter = { _id: req.params.id, ...branchFilter(req.user) };
    const existing = await Reservation.findOne(filter);
    if (!existing) fail(404, "Reservation not found.");
    if (new Date(existing.expiresAt) <= new Date()) {
      await expireReservation(existing);
      fail(409, "This reservation has expired.");
    }

    const reservation = await runTransaction(async (session) => {
      const now = new Date();
      const current = await Reservation.findOne(filter).session(session);
      if (!current) fail(404, "Reservation not found.");
      if (!EXPIRABLE_STATUSES.includes(current.status) || new Date(current.expiresAt) <= now) {
        fail(409, "Reservation is no longer active.");
      }
      const updated = await Reservation.findOneAndUpdate(
        {
          ...filter,
          status: { $in: EXPIRABLE_STATUSES },
          expiresAt: { $gt: now },
        },
        { $set: { status } },
        { new: true, session },
      );
      if (!updated) fail(409, "Reservation changed. Refresh and try again.");
      if (status === "CANCELLED") {
        const inventory = await BranchInventory.findOneAndUpdate(
          {
            branch: updated.branch,
            product: updated.product,
            reservedQuantity: { $gte: updated.quantity },
          },
          { $inc: { reservedQuantity: -updated.quantity } },
          { new: true, session },
        );
        if (!inventory) fail(409, "Reservation hold could not be released.");
      }
      return updated;
    });
    res.json(reservation);
  } catch (error) {
    sendStockError(res, error, "Update reservation");
  }
};

module.exports = {
  getReservations,
  lookupReservation,
  createReservation,
  updateReservationStatus,
};
