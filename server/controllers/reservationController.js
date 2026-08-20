const Reservation = require("../models/Reservation");
const BranchInventory = require("../models/BranchInventory");
const Branch = require("../models/Branch");
const Product = require("../models/Product");

const generateReservationNumber = async () => {
  const count = await Reservation.countDocuments();
  return `RES-${String(count + 1).padStart(6, "0")}`;
};

const releaseExpiredReservations = async () => {
  const expired = await Reservation.find({
    status: "ACTIVE",
    expiresAt: { $lte: new Date() },
  }).select("_id branch product quantity");

  for (const reservation of expired) {
    const released = await Reservation.findOneAndUpdate(
      { _id: reservation._id, status: "ACTIVE" },
      { $set: { status: "EXPIRED" } },
      { new: true }
    );

    if (released) {
      await BranchInventory.findOneAndUpdate(
        { branch: reservation.branch, product: reservation.product },
        { $inc: { reservedQuantity: -reservation.quantity } }
      );
    }
  }
};

const reservationQuery = (req) => {
  const query = {};
  if (req.query.branch) query.branch = req.query.branch;
  else if (req.user.role !== "SUPER_ADMIN" && req.user.branch) query.branch = req.user.branch._id;
  if (req.query.status) query.status = req.query.status;
  return query;
};

const getReservations = async (req, res) => {
  try {
    await releaseExpiredReservations();
    const reservations = await Reservation.find(reservationQuery(req))
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
  let heldInventoryId = null;
  let heldQuantity = 0;

  try {
    const { branch, product, quantity, customerName, customerPhone, expiresAt } = req.body;
    const reservationQuantity = Number(quantity);

    if (!branch || !product || !customerName || reservationQuantity <= 0) {
      return res.status(400).json({ message: "Branch, product, customer name, and quantity are required." });
    }

    const [branchExists, productExists] = await Promise.all([
      Branch.findOne({ _id: branch, isActive: true }),
      Product.findOne({ _id: product, isActive: true }),
    ]);
    if (!branchExists || !productExists) return res.status(404).json({ message: "Active branch or product not found." });

    await releaseExpiredReservations();
    const inventory = await BranchInventory.findOneAndUpdate(
      {
        branch,
        product,
        $expr: {
          $gte: [{ $subtract: ["$quantity", { $ifNull: ["$reservedQuantity", 0] }] }, reservationQuantity],
        },
      },
      { $inc: { reservedQuantity: reservationQuantity } },
      { new: true }
    );

    if (!inventory) return res.status(409).json({ message: "Not enough available stock at this branch." });

    heldInventoryId = inventory._id;
    heldQuantity = reservationQuantity;

    const expiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 2 * 60 * 60 * 1000);
    if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
      await BranchInventory.findByIdAndUpdate(inventory._id, { $inc: { reservedQuantity: -reservationQuantity } });
      return res.status(400).json({ message: "Reservation expiry must be in the future." });
    }

    const reservation = await Reservation.create({
      reservationNumber: await generateReservationNumber(),
      branch,
      product,
      quantity: reservationQuantity,
      customerName,
      customerPhone,
      expiresAt: expiry,
      createdBy: req.user._id,
    });
    const populated = await Reservation.findById(reservation._id)
      .populate("branch", "name code")
      .populate("product", "name sku barcode unit sellingPrice");
    res.status(201).json(populated);
  } catch (error) {
    if (heldInventoryId && heldQuantity) {
      await BranchInventory.findByIdAndUpdate(heldInventoryId, {
        $inc: { reservedQuantity: -heldQuantity },
      });
    }
    res.status(500).json({ message: "Failed to create reservation.", error: error.message });
  }
};

const updateReservationStatus = async (req, res) => {
  try {
    await releaseExpiredReservations();
    const { status } = req.body;
    if (!["READY_FOR_PICKUP", "COMPLETED", "CANCELLED"].includes(status)) {
      return res.status(400).json({ message: "Invalid reservation status." });
    }

    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ message: "Reservation not found." });
    if (!["ACTIVE", "READY_FOR_PICKUP"].includes(reservation.status)) {
      return res.status(400).json({ message: "Reservation is no longer active." });
    }

    if (status === "COMPLETED") {
      const inventory = await BranchInventory.findOneAndUpdate(
        { branch: reservation.branch, product: reservation.product, quantity: { $gte: reservation.quantity }, reservedQuantity: { $gte: reservation.quantity } },
        { $inc: { quantity: -reservation.quantity, reservedQuantity: -reservation.quantity } },
        { new: true }
      );
      if (!inventory) return res.status(409).json({ message: "Inventory cannot fulfill this reservation." });
    } else if (status === "CANCELLED") {
      await BranchInventory.findOneAndUpdate(
        { branch: reservation.branch, product: reservation.product },
        { $inc: { reservedQuantity: -reservation.quantity } }
      );
    }

    reservation.status = status;
    reservation.completedAt = status === "COMPLETED" ? new Date() : undefined;
    await reservation.save();
    res.json(reservation);
  } catch (error) {
    res.status(500).json({ message: "Failed to update reservation." });
  }
};

module.exports = { getReservations, createReservation, updateReservationStatus };
