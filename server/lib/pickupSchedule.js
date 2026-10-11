const { fail } = require("./stockOperations");

const MAX_PICKUP_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const PICKUP_GRACE_MS = 2 * 60 * 60 * 1000;

function parsePickupAt(value) {
  // Compare with the normalized date to reject rolled-over dates such as February 30.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value)) {
    fail(400, "Choose a valid pickup date and time.");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    fail(400, "Choose a valid pickup date and time.");
  }
  return date.toISOString();
}

function validateNewPickup(pickupAt, now = new Date()) {
  if (!pickupAt) fail(400, "Choose a pickup date and time.");
  const pickup = new Date(pickupAt);
  const ahead = pickup.getTime() - new Date(now).getTime();
  if (ahead <= 0) fail(400, "Choose a pickup time in the future (Philippine time).");
  if (ahead > MAX_PICKUP_AHEAD_MS) fail(400, "Choose a pickup time within the next seven days.");
  return pickup;
}

module.exports = { parsePickupAt, validateNewPickup, MAX_PICKUP_AHEAD_MS, PICKUP_GRACE_MS };
