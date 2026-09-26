const crypto = require("node:crypto");
const mongoose = require("mongoose");
const StockOperation = require("../models/StockOperation");

class StockOperationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => {
  throw new StockOperationError(status, message);
};

const positiveQuantity = (value, message = "Quantity must be greater than zero.") => {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) fail(400, message);
  return quantity;
};

const runTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
};

const operationIdentity = (req, operation) => {
  const key = String(req.get?.("Idempotency-Key") || req.headers?.["idempotency-key"] || req.body?.requestId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    fail(400, "A unique Idempotency-Key header is required for this stock action.");
  }
  const bodyWithoutPin = { ...(req.body || {}) };
  delete bodyWithoutPin.approvalPin;
  return {
    actor: req.user._id,
    key,
    operation,
    requestHash: crypto.createHash("sha256")
      .update(JSON.stringify({ operation, body: bodyWithoutPin }))
      .digest("hex"),
  };
};

const replayResult = (record, identity, user) => {
  if (!record) return null;
  if (record.operation !== identity.operation || record.requestHash !== identity.requestHash) {
    fail(409, "This Idempotency-Key was already used for a different request.");
  }
  const body = record.result?.body;
  const branch = body?.sale?.branch || body?.purchaseOrder?.branch || body?.inventory?.branch;
  const branchId = branch?._id || branch;
  const assignedBranch = user?.branch?._id || user?.branch;
  if (branchId && user?.role !== "SUPER_ADMIN" && String(branchId) !== String(assignedBranch)) {
    fail(404, "Record not found.");
  }
  return record.result;
};

const runStockOperation = async (req, operation, work) => {
  const identity = operationIdentity(req, operation);
  await StockOperation.init();
  const filter = { actor: identity.actor, key: identity.key };
  const existing = await StockOperation.findOne(filter).lean();
  const replay = replayResult(existing, identity, req.user);
  if (replay) return replay;

  try {
    return await runTransaction(async (session) => {
      const result = await work(session);
      await StockOperation.create([{ ...identity, result: JSON.parse(JSON.stringify(result)) }], { session });
      return result;
    });
  } catch (error) {
    if (error.code === 11000) {
      const completed = await StockOperation.findOne(filter).lean();
      const duplicateResult = replayResult(completed, identity, req.user);
      if (duplicateResult) return duplicateResult;
    }
    throw error;
  }
};

const sendStockError = (res, error, context) => {
  if (error instanceof StockOperationError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error(`${context}:`, error);
  return res.status(500).json({ message: `Failed to ${context.toLowerCase()}.` });
};

module.exports = {
  StockOperationError,
  fail,
  positiveQuantity,
  runTransaction,
  runStockOperation,
  sendStockError,
};
