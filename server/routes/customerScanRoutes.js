const express = require("express");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const multer = require("multer");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const Customer = require("../models/Customer");
const CustomerScan = require("../models/CustomerScan");
const CustomerScanBudget = require("../models/CustomerScanBudget");
const { normalizeRoom } = require("../lib/scanspaceDomain");
const { createCustomerAuthMiddleware } = require("../middleware/customerAuthMiddleware");
const { runTransaction } = require("../lib/stockOperations");
const { createCustomerScanStorage, storageError } = require("../lib/customerScanStorage");
const { createCustomerScanUpload } = require("../lib/customerScanUpload");

const BUDGET_ID = "supabase-scanspace";
const LEASE_MS = 10 * 60 * 1000;
const fail = (status, message) => { throw storageError(message, status); };
const query = (value, session) => session ? value.session(session) : value;

function customization(value) {
  if (!value || value.version !== 1) return null;
  const result = { version: 1 };
  for (const kind of ["walls", "ceiling"]) {
    const paint = value[kind];
    if (/^#[0-9a-f]{6}$/i.test(paint?.color || "") && ["Matte", "Eggshell", "Satin"].includes(paint.finish))
      result[kind] = { color: paint.color.toLowerCase(), finish: paint.finish };
  }
  if (["oak", "walnut", "stone", "light-vinyl"].includes(value.floor?.finishId) && ["lengthwise", "crosswise"].includes(value.floor?.direction))
    result.floor = { finishId: value.floor.finishId, direction: value.floor.direction };
  return result.walls || result.ceiling || result.floor ? result : null;
}

function design(body, kind) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120 || /[\u0000-\u001f]/.test(name)) fail(400, "Enter a scan name of up to 120 characters.");
  if (kind === "room") {
    try { return { name, room: normalizeRoom({ ...body.room, name }), customization: null }; }
    catch { fail(400, "The room design is invalid. Check its measurements."); }
  }
  return { name, room: null, customization: customization(body.customization) };
}

function view(record, includeDesign = false, now = new Date()) {
  const expired = record.status === "uploading" && new Date(record.leaseUntil) <= now;
  return {
    id: String(record._id), name: record.name, kind: record.kind,
    byteSize: record.byteSize, sha256: record.sha256, revision: record.revision,
    status: expired ? "incomplete" : record.status,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    ...(includeDesign ? { room: record.room || null, customization: record.customization || null } : {}),
  };
}

function createCustomerScanRouter({
  ScanModel = CustomerScan, BudgetModel = CustomerScanBudget, CustomerModel = Customer,
  storage = createCustomerScanStorage(), staging = createCustomerScanUpload(),
  getAuth, transaction = runTransaction, now = () => new Date(),
  capacity = Number(process.env.SCANSPACE_TOTAL_STORAGE_BYTES || 1000000000),
} = {}) {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error("SCANSPACE_TOTAL_STORAGE_BYTES must be a positive total storage allowance.");
  const router = express.Router();
  let indexesReady, activeUploads = 0;
  const upload = multer({ storage: staging, limits: { files: 1, fields: 1, parts: 2, fieldSize: 1024 * 1024 },
    fileFilter: (req, file, callback) => callback(/\.json$/i.test(file.originalname) ? null : storageError("Choose a ScanSpace JSON file.", 400), true),
  }).single("file");
  const report = (res, error) => {
    if (res.headersSent || res.destroyed) return;
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error instanceof multer.MulterError) return res.status(400).json({ message: "Upload one scan file with its design details." });
    console.error("Customer scan request failed:", error.code || error.name);
    res.status(503).json({ message: "Saved scans are unavailable. Your original file is still on this device. Please retry." });
  };
  const initialize = async () => {
    if (!indexesReady) indexesReady = Promise.all([ScanModel.createIndexes(), BudgetModel.createIndexes()])
      .then(() => BudgetModel.updateOne({ _id: BUDGET_ID }, { $setOnInsert: { usedBytes: 0 } }, { upsert: true }))
      .catch(error => { indexesReady = null; throw error; });
    await indexesReady;
  };
  const owned = req => ({ _id: req.params.id, ownerUid: req.customerClaims.uid });
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use(createCustomerAuthMiddleware({ getAuth }));
  router.use(async (req, res, next) => {
    try {
      if (req.customerClaims.email_verified !== true) return res.status(403).json({ message: "Verify your email to save and open account scans.", code: "EMAIL_NOT_VERIFIED" });
      const customer = await CustomerModel.findOne({ firebaseUid: req.customerClaims.uid });
      if (!customer) fail(409, "Reload your account before saving scans.");
      if (!customer.isActive) fail(403, "This customer account is disabled. Please contact the store.");
      if (req.params.id && !mongoose.isObjectIdOrHexString(req.params.id)) fail(404, "Scan not found.");
      next();
    } catch (error) { report(res, error); }
  });
  router.param("id", (req, res, next, id) => mongoose.isObjectIdOrHexString(id) ? next() : res.status(404).json({ message: "Scan not found." }));

  router.get("/", async (req, res) => {
    try {
      const records = await ScanModel.find({ ownerUid: req.customerClaims.uid }).sort({ updatedAt: -1 }).limit(100);
      res.json({ scans: records.map(record => view(record, false, now())) });
    } catch (error) { report(res, error); }
  });

  router.post("/", async (req, res) => {
    let record, lease;
    let slot = false;
    try {
      const requestKey = req.get("Idempotency-Key") || "";
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestKey)) fail(400, "A unique scan save key is required.");
      if (activeUploads >= 2) fail(429, "Two scans are currently being saved. Please retry shortly.");
      activeUploads++; slot = true;
      req.setTimeout(120000);
      await storage.assertReady();
      await initialize();
      const identity = { ownerUid: req.customerClaims.uid, requestKey };
      const [existing, budget] = await Promise.all([ScanModel.findOne(identity), BudgetModel.findById(BUDGET_ID)]);
      req.scanStorageRemaining = Math.max(0, capacity - budget.usedBytes + (existing?.byteSize || 0));
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      // Cloud chunks have their own timeout; a completed multipart body may take
      // longer than the input inactivity window to finish saving.
      req.setTimeout(0);
      const file = req.file;
      if (!file?.size) fail(400, "Choose an original scan file to save.");
      let body;
      try { body = JSON.parse(req.body.metadata); } catch { fail(400, "The scan details are invalid."); }
      if (!["scan", "room"].includes(body.kind)) fail(400, "Choose a scan or room file.");
      const raw = /^\s*\{\s*"format"\s*:\s*"scanspace-(?:scan|partial-surface)"/i.test(file.beginning);
      const room = /^\s*\{/.test(file.beginning) && /"floorPolygon"\s*:/.test(file.beginning) && !/^\s*\{\s*"capture"\s*:/.test(file.beginning);
      if (body.kind === "scan" ? !raw : !room) fail(400, "This file is not a ScanSpace original. Export or import a supported scan or room.");
      const values = design(body, body.kind);
      const replay = current => {
        if (current.sha256 !== file.sha256 || current.byteSize !== file.size || current.kind !== body.kind)
          fail(409, "This save key belongs to a different original file.");
        if (current.status === "deleting") fail(409, "This scan is being removed. Start a new save.");
        return current;
      };
      record = existing ? replay(existing) : await transaction(async session => {
        const duplicate = await query(ScanModel.findOne(identity), session);
        if (duplicate) return replay(duplicate);
        const reserved = await BudgetModel.findOneAndUpdate({ _id: BUDGET_ID, usedBytes: { $lte: capacity - file.size } }, { $inc: { usedBytes: file.size } }, { new: true, session });
        if (!reserved) fail(507, "The included scan storage is full. Remove older saves to make space.");
        const [created] = await ScanModel.create([{ ...identity, ...values, kind: body.kind, byteSize: file.size, sha256: file.sha256, chunkSize: storage.chunkSize, status: "incomplete" }], { session });
        return created;
      });
      if (record.status === "ready") return res.json({ scan: view(record, true, now()) });
      lease = crypto.randomUUID();
      record = await ScanModel.findOneAndUpdate({ _id: record._id, ownerUid: identity.ownerUid, $or: [
        { status: "incomplete" }, { status: "uploading", leaseUntil: { $lte: now() } },
      ] }, { $set: { ...values, status: "uploading", lease, leaseUntil: new Date(now().getTime() + LEASE_MS) } }, { new: true });
      if (!record) fail(409, "This scan is already being saved. Wait briefly, then retry.");
      await storage.upload(record, file.path, async () => {
        const update = await ScanModel.updateOne({ _id: record._id, status: "uploading", lease }, { $set: { leaseUntil: new Date(now().getTime() + LEASE_MS) } });
        if (!update.matchedCount) fail(409, "This save was interrupted. Please retry.");
      });
      const saved = await ScanModel.findOneAndUpdate({ _id: record._id, status: "uploading", lease }, { $set: { status: "ready" }, $unset: { lease: 1, leaseUntil: 1 } }, { new: true });
      if (!saved) fail(409, "The save confirmation was interrupted. Retry to recover it.");
      res.status(201).json({ scan: view(saved, true, now()) });
    } catch (error) {
      if (record && lease) await ScanModel.updateOne({ _id: record._id, status: "uploading", lease }, { $set: { status: "incomplete" }, $unset: { lease: 1, leaseUntil: 1 } }).catch(() => {});
      report(res, error);
    } finally {
      if (slot) activeUploads--;
      if (req.file?.path) await staging.remove(req.file.path).catch(error => console.error("Scan temporary file cleanup failed:", error.code || error.name));
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const record = await ScanModel.findOne(owned(req));
      if (!record) fail(404, "Scan not found.");
      res.json({ scan: view(record, true, now()) });
    } catch (error) { report(res, error); }
  });
  router.get("/:id/file", async (req, res) => {
    try {
      const record = await ScanModel.findOne({ ...owned(req), status: "ready" });
      if (!record) fail(404, "Saved original not found.");
      await storage.assertReady();
      res.set({ "Content-Type": "application/json", "Content-Length": String(record.byteSize), "Content-Disposition": `attachment; filename="scanspace-${record._id}.json"`, "X-Content-Type-Options": "nosniff" });
      await pipeline(Readable.from(storage.download(record)), res);
    } catch (error) { if (res.headersSent) res.destroy(); else report(res, error); }
  });
  router.patch("/:id", async (req, res) => {
    try {
      const current = await ScanModel.findOne({ ...owned(req), status: "ready" });
      if (!current) fail(404, "Scan not found.");
      if (!Number.isSafeInteger(req.body?.revision) || req.body.revision < 1) fail(400, "Refresh this scan before saving changes.");
      const saved = await ScanModel.findOneAndUpdate({ ...owned(req), status: "ready", revision: req.body.revision }, { $set: design(req.body, current.kind), $inc: { revision: 1 } }, { new: true, runValidators: true });
      if (!saved) fail(409, "This scan was changed on another device. Reopen it before saving.");
      res.json({ scan: view(saved, true, now()) });
    } catch (error) { report(res, error); }
  });
  router.delete("/:id", async (req, res) => {
    try {
      const record = await ScanModel.findOneAndUpdate({ ...owned(req), $or: [
        { status: { $in: ["ready", "incomplete", "deleting"] } }, { status: "uploading", leaseUntil: { $lte: now() } },
      ] }, { $set: { status: "deleting" }, $unset: { lease: 1, leaseUntil: 1 } }, { new: true });
      if (!record) fail(404, "Scan not found, or an upload is still running.");
      await storage.assertReady();
      await storage.remove(record);
      await transaction(async session => {
        const removed = await query(ScanModel.findOneAndDelete({ ...owned(req), status: "deleting" }), session);
        if (removed) await BudgetModel.updateOne({ _id: BUDGET_ID }, { $inc: { usedBytes: -removed.byteSize } }, { session });
      });
      res.status(204).end();
    } catch (error) { report(res, error); }
  });
  return router;
}

module.exports = { createCustomerScanRouter, router: createCustomerScanRouter() };
