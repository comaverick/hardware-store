const express = require("express");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Customer = require("../models/Customer");
const Reservation = require("../models/Reservation");
const Branch = require("../models/Branch");
const Product = require("../models/Product");
const Inventory = require("../models/BranchInventory");
const { createCustomerAuthMiddleware } = require("../middleware/customerAuthMiddleware");
const { fail, runTransaction, sendStockError } = require("../lib/stockOperations");
const { releaseReservationStock } = require("../lib/reservationItems");
const { EXPIRABLE_STATUSES } = require("../lib/reservationExpiry");

const HOLD_MS = 2 * 60 * 60 * 1000;

function parseCart(body) {
  if (!mongoose.isObjectIdOrHexString(body?.branch)) fail(400, "Select a valid pickup branch.");
  const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim() : "";
  if (!customerName || customerName.length > 100) fail(400, "Enter a pickup name of up to 100 characters.");
  if (customerPhone && !/^[+\d() .-]{7,30}$/.test(customerPhone)) fail(400, "Enter a valid contact number.");
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) {
    fail(400, "A reservation must contain between 1 and 50 different products.");
  }
  const seen = new Set();
  const items = body.items.map((item) => {
    if (!mongoose.isObjectIdOrHexString(item?.product) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999) {
      fail(400, "Each product needs a whole quantity between 1 and 9,999.");
    }
    if (typeof item.unitPrice !== "number" || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      fail(400, "Refresh the cart to check current prices.");
    }
    const product = String(item.product).toLowerCase();
    if (seen.has(product)) fail(400, "Each product can appear only once in the cart.");
    seen.add(product);
    return { product, quantity: item.quantity, unitPrice: item.unitPrice };
  }).sort((a, b) => a.product.localeCompare(b.product));
  return { branch: String(body.branch).toLowerCase(), customerName, customerPhone, items };
}

function customerView(record) {
  const branch = record.branch;
  const items = record.items.map((item) => ({
    productId: String(item.product?._id || item.product), name: item.name, sku: item.sku,
    unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice,
    total: Number((item.quantity * item.unitPrice).toFixed(2)),
  }));
  return {
    id: String(record._id), reservationNumber: record.reservationNumber,
    branch: { id: String(branch._id || branch), name: branch.name || "Pickup branch", code: branch.code || "", address: branch.address || "", phone: branch.phone || "" },
    customerName: record.customerName, customerPhone: record.customerPhone || "",
    status: EXPIRABLE_STATUSES.includes(record.status) && new Date(record.expiresAt) <= new Date() ? "EXPIRED" : record.status,
    expiresAt: record.expiresAt, createdAt: record.createdAt,
    items, total: Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2)),
  };
}

function createCustomerReservationRouter({
  CustomerModel = Customer, ReservationModel = Reservation, BranchModel = Branch,
  ProductModel = Product, InventoryModel = Inventory, transaction = runTransaction, getAuth,
} = {}) {
  const router = express.Router();
  let indexesReady;
  const populate = (query) => query.populate("branch", "name code address phone");
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use(createCustomerAuthMiddleware({ getAuth }));
  router.use(async (req, res, next) => {
    if (req.customerClaims.email_verified !== true) {
      return res.status(403).json({ message: "Verify your email before reserving items.", code: "EMAIL_NOT_VERIFIED" });
    }
    try {
      const customer = await CustomerModel.findOne({ firebaseUid: req.customerClaims.uid });
      if (!customer) return res.status(409).json({ message: "Reload your account before reserving items." });
      if (!customer.isActive) return res.status(403).json({ message: "This customer account is disabled. Please contact the store." });
      req.customer = customer;
      next();
    } catch (error) {
      sendStockError(res, error, "Load customer account");
    }
  });

  router.get("/", async (req, res) => {
    try {
      const records = await populate(ReservationModel.find({ customer: req.customer._id, source: "CUSTOMER" }))
        .sort({ createdAt: -1 }).limit(100);
      res.json({ reservations: records.map(customerView) });
    } catch (error) { sendStockError(res, error, "Load reservations"); }
  });

  router.post("/", async (req, res) => {
    try {
      const cart = parseCart(req.body);
      const requestId = req.get("Idempotency-Key") || "";
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) fail(400, "A unique reservation request key is required.");
      const requestHash = crypto.createHash("sha256").update(JSON.stringify(cart)).digest("hex");
      const identity = { customer: req.customer._id, source: "CUSTOMER", requestId };
      if (!indexesReady) {
        indexesReady = Promise.resolve().then(() => ReservationModel.createIndexes()).catch((error) => {
          indexesReady = null;
          throw error;
        });
      }
      await indexesReady;
      const replay = async () => {
        const existing = await populate(ReservationModel.findOne(identity));
        if (!existing) return null;
        if (existing.requestHash !== requestHash) fail(409, "This request key was already used for another cart.");
        return existing;
      };
      let reservation = await replay();
      if (!reservation) {
        try {
          const created = await transaction(async (session) => {
            const branch = await BranchModel.findOne({ _id: cart.branch, isActive: true }).session(session);
            if (!branch) fail(404, "This pickup branch is unavailable. Choose another branch.");
            const items = [];
            for (const item of cart.items) {
              const product = await ProductModel.findOne({ _id: item.product, isActive: true }).session(session);
              if (!product) fail(409, "An item is no longer available. Refresh your cart.");
              const unitPrice = Number(product.sellingPrice);
              if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice !== item.unitPrice) {
                fail(409, `The price of ${product.name} changed. Refresh your cart before reserving.`);
              }
              const inventory = await InventoryModel.findOneAndUpdate({
                branch: cart.branch, product: item.product,
                $expr: { $gte: [{ $subtract: ["$quantity", { $ifNull: ["$reservedQuantity", 0] }] }, item.quantity] },
              }, { $inc: { reservedQuantity: item.quantity } }, { new: true, session });
              if (!inventory) fail(409, `Not enough stock of ${product.name} at ${branch.name}. Refresh your cart or choose another branch.`);
              items.push({ product: product._id, name: product.name, sku: product.sku, unit: product.unit, quantity: item.quantity, unitPrice });
            }
            const [record] = await ReservationModel.create([{
              ...identity, requestHash, reservationNumber: `RES-WEB-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
              branch: branch._id, items, customerName: cart.customerName, customerPhone: cart.customerPhone,
              customerEmail: req.customerClaims.email.trim().toLowerCase(), status: "ACTIVE",
              expiresAt: new Date(Date.now() + HOLD_MS),
            }], { session });
            return record;
          });
          reservation = await populate(ReservationModel.findById(created._id));
        } catch (error) {
          if (error.code !== 11000) throw error;
          reservation = await replay();
          if (!reservation) throw error;
        }
      }
      res.status(201).json({ reservation: customerView(reservation) });
    } catch (error) { sendStockError(res, error, "Reserve cart"); }
  });

  router.post("/:id/cancel", async (req, res) => {
    try {
      if (!mongoose.isObjectIdOrHexString(req.params.id)) fail(404, "Reservation not found.");
      const identity = { _id: req.params.id, customer: req.customer._id, source: "CUSTOMER" };
      const record = await transaction(async (session) => {
        const current = await ReservationModel.findOne(identity).session(session);
        if (!current) fail(404, "Reservation not found.");
        if (!EXPIRABLE_STATUSES.includes(current.status)) return current;
        const status = new Date(current.expiresAt) <= new Date() ? "EXPIRED" : "CANCELLED";
        const updated = await ReservationModel.findOneAndUpdate({ ...identity, status: { $in: EXPIRABLE_STATUSES } },
          { $set: { status } }, { new: true, session });
        if (!updated) fail(409, "Reservation changed. Refresh and try again.");
        await releaseReservationStock(updated, session, InventoryModel);
        return updated;
      });
      const populated = await populate(ReservationModel.findById(record._id));
      res.json({ reservation: customerView(populated) });
    } catch (error) { sendStockError(res, error, "Cancel reservation"); }
  });
  return router;
}

module.exports = { router: createCustomerReservationRouter(), createCustomerReservationRouter, parseCart, customerView };
