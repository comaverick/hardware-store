const PHILIPPINE_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_PICKUP_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

function philippineFields(timestamp) {
  const local = new Date(timestamp + PHILIPPINE_OFFSET_MS).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

export function pickupToIso(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const timestamp = new Date(`${date}T${time}:00.000+08:00`).getTime();
  if (!Number.isFinite(timestamp)) return null;
  const normalized = philippineFields(timestamp);
  return normalized.date === date && normalized.time === time ? new Date(timestamp).toISOString() : null;
}

export function pickupError(date, time, now = Date.now()) {
  if (!date || !time) return "Choose a pickup date and time.";
  const pickupAt = pickupToIso(date, time);
  if (!pickupAt) return "Choose a valid pickup date and time.";
  const ahead = new Date(pickupAt).getTime() - now;
  if (ahead <= 0) return "Choose a pickup time in the future (Philippine time).";
  if (ahead > MAX_PICKUP_AHEAD_MS) return "Choose a pickup time within the next seven days.";
  return "";
}

export function pickupBounds(now = Date.now()) {
  const firstMinute = Math.floor(now / 60000) * 60000 + 60000;
  return { min: philippineFields(firstMinute), max: philippineFields(now + MAX_PICKUP_AHEAD_MS) };
}
