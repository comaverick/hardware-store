const mongoose = require("mongoose");
const Reservation = require("../models/Reservation");
const BranchInventory = require("../models/BranchInventory");
const { fail, runTransaction } = require("./stockOperations");

const EXPIRABLE_STATUSES = ["ACTIVE", "READY_FOR_PICKUP"];
const INTERVAL_MS = 60 * 1000;
let timer = null;
let running = false;
const status = { lastRunAt: null, lastError: null, lastExpired: 0 };

const expireReservation = async (candidate, now = new Date()) => {
  if (
    !candidate ||
    !EXPIRABLE_STATUSES.includes(candidate.status) ||
    new Date(candidate.expiresAt) > now
  ) return false;

  return runTransaction(async (session) => {
    const reservation = await Reservation.findOneAndUpdate(
      {
        _id: candidate._id,
        status: { $in: EXPIRABLE_STATUSES },
        expiresAt: { $lte: now },
      },
      { $set: { status: "EXPIRED" } },
      { new: true, session },
    );
    if (!reservation) return false;

    const inventory = await BranchInventory.findOneAndUpdate(
      {
        branch: reservation.branch,
        product: reservation.product,
        reservedQuantity: { $gte: reservation.quantity },
      },
      { $inc: { reservedQuantity: -reservation.quantity } },
      { new: true, session },
    );
    if (!inventory) fail(409, `Could not release expired reservation ${reservation.reservationNumber}.`);
    return true;
  });
};

const processExpiredReservations = async ({ branchId = null, batchSize = 100, maxBatches = 10 } = {}) => {
  const failedIds = [];
  const errors = [];
  let expired = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const query = {
      status: { $in: EXPIRABLE_STATUSES },
      expiresAt: { $lte: new Date() },
      ...(branchId ? { branch: branchId } : {}),
      ...(failedIds.length ? { _id: { $nin: failedIds } } : {}),
    };
    const candidates = await Reservation.find(query)
      .sort({ expiresAt: 1 })
      .limit(batchSize)
      .select("_id reservationNumber status expiresAt branch product quantity");
    if (!candidates.length) break;

    for (const candidate of candidates) {
      try {
        if (await expireReservation(candidate)) expired += 1;
      } catch (error) {
        failedIds.push(candidate._id);
        errors.push(error);
      }
    }
    if (candidates.length < batchSize) break;
  }
  return { expired, errors };
};

const runExpiryPass = async () => {
  if (running || mongoose.connection.readyState !== 1) return;
  running = true;
  try {
    const result = await processExpiredReservations();
    status.lastRunAt = new Date().toISOString();
    status.lastExpired = result.expired;
    status.lastError = result.errors.length ? result.errors[0].message : null;
    for (const error of result.errors) console.error("Reservation expiry error:", error);
  } catch (error) {
    status.lastError = error.message;
    console.error("Reservation expiry pass failed:", error);
  } finally {
    running = false;
  }
};

const startReservationExpiryWorker = () => {
  if (timer) return;
  mongoose.connection.on("connected", runExpiryPass);
  timer = setInterval(runExpiryPass, INTERVAL_MS);
  timer.unref?.();
  runExpiryPass();
};

const getReservationExpiryStatus = () => ({ ...status });

module.exports = {
  EXPIRABLE_STATUSES,
  expireReservation,
  processExpiredReservations,
  runExpiryPass,
  startReservationExpiryWorker,
  getReservationExpiryStatus,
};
