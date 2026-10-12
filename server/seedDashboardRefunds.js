// Preview: node seedDashboardRefunds.js --date 2026-10-11
// Insert:  node seedDashboardRefunds.js --date 2026-10-11 --apply
const mongoose = require("mongoose");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const Branch = require("./models/Branch");
const BranchInventory = require("./models/BranchInventory");
const Sale = require("./models/Sale");
const User = require("./models/User");
const InventoryTransaction = require("./models/InventoryTransaction");
const AuditLog = require("./models/AuditLog");

const args = process.argv.slice(2);
const dateFlag = args.indexOf("--date");
const manilaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const anchorDate = dateFlag === -1 ? manilaDate : args[dateFlag + 1];
const anchor = new Date(`${anchorDate}T00:00:00+08:00`);
const dayMs = 86400000;
const dateKey = (date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate || "") || Number.isNaN(anchor.getTime()) || dateKey(anchor) !== anchorDate) {
  throw new Error("Use --date YYYY-MM-DD.");
}
if (anchorDate > manilaDate) throw new Error("Demo refunds cannot be dated in the future.");
const apply = args.includes("--apply");
const batchDate = anchorDate.replaceAll("-", "");
const receiptPrefix = `DEMO-DASH-${batchDate}-`;
const marker = `[DEMO-REFUND-${batchDate}]`;
const batchFilter = { receiptNumber: { $regex: `^${receiptPrefix}` } };
const [year, month] = anchorDate.split("-").map(Number);
const lastMonthStart = new Date(Date.UTC(year, month - 2, 1, -8));
const lastMonthEnd = new Date(Date.UTC(year, month - 1, 1, -8));
const monthDays = Math.round((lastMonthEnd - lastMonthStart) / dayMs);
const weekStart = new Date(anchor.getTime() - 6 * dayMs);
const tomorrow = new Date(anchor.getTime() + dayMs);
const now = new Date();
const stockKey = (branch, product) => `${branch}:${product}`;
const cents = (amount) => Math.round(amount * 100);

const profiles = [
  { monthDays: [4, 8, 13, 19, 24, 29], weekOffsets: [0, 2, 4, 5, 6] },
  { monthDays: [2, 6, 9, 12, 17, 21, 26, 30], weekOffsets: [0, 1, 2, 3, 4, 5, 6] },
  { monthDays: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30], weekOffsets: [0, 1, 2, 3, 4, 5, 6, 6] },
  { monthDays: [2, 4, 7, 9, 12, 14, 17, 19, 22, 24, 27, 29], weekOffsets: [0, 1, 2, 3, 4, 4, 5, 6, 6] },
];

function targetsFor(branchIndex) {
  const profile = profiles[branchIndex % profiles.length];
  return [
    ...profile.monthDays.filter((day) => day <= monthDays).map((day) => new Date(lastMonthStart.getTime() + (day - 1) * dayMs)),
    ...profile.weekOffsets.map((offset) => new Date(weekStart.getTime() + offset * dayMs)),
  ];
}

function randomFor(seed) {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function summarize(branches, sales) {
  return branches.map((branch) => {
    const branchSales = sales.filter((sale) => String(sale.branch) === String(branch._id));
    const refunds = branchSales.flatMap((sale) => sale.refunds.filter((refund) => refund.reason.startsWith(marker)));
    const period = (start, end) => {
      const records = refunds.filter((refund) => refund.createdAt >= start && refund.createdAt < end);
      return { refunds: records.length, amount: records.reduce((sum, refund) => sum + cents(refund.amount), 0) / 100 };
    };
    return {
      branch: branch.code, today: period(anchor, tomorrow), week: period(weekStart, tomorrow), lastMonth: period(lastMonthStart, lastMonthEnd),
      refunds: refunds.length,
      fullReturns: branchSales.filter((sale) => sale.status === "REFUNDED" && sale.refunds.some((refund) => refund.reason.startsWith(marker))).length,
      partialReturns: branchSales.filter((sale) => sale.status === "PARTIALLY_REFUNDED" && sale.refunds.some((refund) => refund.reason.startsWith(marker))).length,
      unitsReturned: refunds.reduce((sum, refund) => sum + refund.items.reduce((units, item) => units + item.quantity, 0), 0),
    };
  });
}

async function seed(session) {
  const branches = await Branch.find({ isActive: true }).sort({ code: 1 }).session(session).lean();
  if (!branches.length) throw new Error("No active branches found.");
  const sales = await Sale.find(batchFilter).sort({ createdAt: 1, receiptNumber: 1 }).session(session).lean();
  const expectedCount = branches.reduce((sum, branch, index) => sum + targetsFor(index).length, 0);
  const existingCount = sales.reduce((sum, sale) => sum + sale.refunds.filter((refund) => refund.reason.startsWith(marker)).length, 0);
  if (existingCount) {
    if (existingCount !== expectedCount) throw new Error("This refund batch is incomplete; review its records before applying again.");
    return { alreadySeeded: true, inserted: 0, summary: summarize(branches, sales) };
  }
  const actor = await User.findOne({ role: "SUPER_ADMIN", isActive: true }).session(session).select("_id").lean();
  if (!actor) throw new Error("An active super admin is required to audit this import.");
  const inventories = await BranchInventory.find({ branch: { $in: branches.map((branch) => branch._id) } }).session(session).lean();
  const inventoryMap = new Map(inventories.map((inventory) => [stockKey(inventory.branch, inventory.product), {
    inventory, quantity: inventory.quantity, returned: 0,
  }]));
  const saleUpdates = [];
  const changedSales = [];
  const movements = [];
  const audits = [];
  const reasons = ["Customer ordered the wrong size", "Changed project requirements", "Returned unused items"];

  for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
    const branch = branches[branchIndex];
    const manager = await User.findOne({
      branch: branch._id, role: "MANAGER", isActive: true,
      email: `manager.${branch.code.toLowerCase()}@hardware-store.local`,
    }).session(session).select("_id").lean();
    if (!manager) throw new Error(`Missing the demo manager for ${branch.code}.`);
    const branchSales = sales.filter((sale) => String(sale.branch) === String(branch._id) && sale.status === "COMPLETED" && sale.refunds.length === 0);
    const used = new Set();
    const targets = targetsFor(branchIndex);
    for (let index = 0; index < targets.length; index += 1) {
      const date = targets[index];
      const random = randomFor(`${marker}:${branch.code}:${dateKey(date)}:${index}`);
      const processedAt = new Date(date.getTime() + (17 * 60 + branchIndex * 7 + (index % 2) * 20 + Math.floor(random() * 10)) * 60000);
      if (processedAt > now) throw new Error("This batch includes future opening hours. Run after closing time or choose an earlier date.");
      const wantsFullReturn = (index + branchIndex) % 4 === 0;
      const eligible = branchSales.filter((sale) => !used.has(String(sale._id)) && sale.createdAt <= processedAt);
      const partialEligible = wantsFullReturn ? eligible : eligible.filter((sale) => sale.items.reduce((sum, item) => sum + item.quantity, 0) > 1);
      const preferred = partialEligible.filter((sale) => processedAt - sale.createdAt <= 4 * dayMs);
      const pool = preferred.length ? preferred : partialEligible.length ? partialEligible : eligible;
      if (!pool.length) throw new Error(`Not enough demo receipts for ${branch.code}; seed its dashboard sales first.`);
      const original = pool[Math.floor(random() * pool.length)];
      used.add(String(original._id));
      const sale = new Sale(original);
      const fullReturn = wantsFullReturn || sale.items.reduce((sum, item) => sum + item.quantity, 0) === 1;
      const lines = fullReturn ? [...sale.items] : [sale.items[Math.floor(random() * sale.items.length)]];
      const factor = sale.subtotal > 0 ? sale.totalAmount / sale.subtotal : 1;
      const returnedItems = lines.map((item) => {
        const quantity = fullReturn ? item.quantity : 1;
        return { saleItemId: item._id, product: item.product, quantity, amount: Math.round(item.unitPrice * quantity * factor * 100) / 100 };
      });
      let refundCents = returnedItems.reduce((sum, item) => sum + cents(item.amount), 0);
      let excess = refundCents - cents(sale.totalAmount - sale.refundedAmount);
      for (let line = returnedItems.length - 1; line >= 0 && excess > 0; line -= 1) {
        const reduction = Math.min(excess, cents(returnedItems[line].amount));
        returnedItems[line].amount = (cents(returnedItems[line].amount) - reduction) / 100;
        refundCents -= reduction;
        excess -= reduction;
      }
      if (excess > 0 || refundCents <= 0) throw new Error("A sample refund exceeds its paid amount.");
      const reason = `${marker} ${reasons[(index + branchIndex) % reasons.length]}`;
      for (let line = 0; line < returnedItems.length; line += 1) {
        const item = returnedItems[line];
        lines[line].refundedQuantity = item.quantity;
        const stock = inventoryMap.get(stockKey(branch._id, item.product));
        if (!stock) throw new Error(`Missing inventory for a returned product in ${branch.code}.`);
        movements.push({
          product: item.product, branch: branch._id, type: "STOCK_IN", quantity: item.quantity,
          previousQuantity: stock.quantity, newQuantity: stock.quantity + item.quantity,
          reason: "Customer return", reference: sale.receiptNumber, performedBy: manager._id,
          notes: `${reason}; demo refund processed ${processedAt.toISOString()} (Asia/Manila).`,
          createdAt: now, updatedAt: now,
        });
        stock.quantity += item.quantity;
        stock.returned += item.quantity;
      }
      sale.refundedAmount = refundCents / 100;
      sale.refunds.push({ refundedBy: manager._id, approvedBy: manager._id, amount: refundCents / 100, reason, items: returnedItems, createdAt: processedAt });
      sale.status = sale.items.every((item) => item.refundedQuantity >= item.quantity) ? "REFUNDED" : "PARTIALLY_REFUNDED";
      sale.updatedAt = now;
      await sale.validate();
      const changed = sale.toObject();
      changedSales.push(changed);
      saleUpdates.push({ updateOne: {
        filter: { _id: original._id, status: "COMPLETED", refundedAmount: 0, refunds: { $size: 0 }, updatedAt: original.updatedAt },
        update: { $set: { items: changed.items, refunds: changed.refunds, refundedAmount: changed.refundedAmount, status: changed.status, updatedAt: now } },
        timestamps: false,
      } });
    }
    audits.push({
      actor: actor._id, action: "SEED DASHBOARD REFUNDS", method: "POST", path: "/scripts/seed-dashboard-refunds", statusCode: 201,
      branch: branch._id, metadata: { sampleData: true, refundMarker: marker, receiptPrefix, anchorDate, timeZone: "Asia/Manila", refunds: targets.length, approvedBy: String(manager._id) },
    });
  }
  for (const movement of movements) await new InventoryTransaction(movement).validate();
  for (const audit of audits) await new AuditLog(audit).validate();
  const inventoryUpdates = [...inventoryMap.values()].filter((stock) => stock.returned).map((stock) => ({ updateOne: {
    filter: { _id: stock.inventory._id, quantity: stock.inventory.quantity,
      $expr: { $eq: [{ $ifNull: ["$reservedQuantity", 0] }, stock.inventory.reservedQuantity || 0] } },
    update: { $inc: { quantity: stock.returned } },
  } }));
  if (apply) {
    const updatedSales = await Sale.bulkWrite(saleUpdates, { session, timestamps: false });
    if (updatedSales.modifiedCount !== saleUpdates.length) throw new Error("A receipt changed during preparation; the import was rolled back.");
    const updatedInventory = await BranchInventory.bulkWrite(inventoryUpdates, { session });
    if (updatedInventory.modifiedCount !== inventoryUpdates.length) throw new Error("Inventory changed during preparation; the import was rolled back.");
    await InventoryTransaction.insertMany(movements, { session });
    await AuditLog.insertMany(audits, { session });
    const saved = await Sale.find({ _id: { $in: changedSales.map((sale) => sale._id) } }).session(session).lean();
    if (saved.length !== expectedCount || JSON.stringify(summarize(branches, saved)) !== JSON.stringify(summarize(branches, changedSales))) {
      throw new Error("Persisted refunds do not match the planned dates and totals; the import was rolled back.");
    }
  }
  return { alreadySeeded: false, inserted: apply ? changedSales.length : 0, planned: changedSales.length, stockMovements: movements.length, summary: summarize(branches, changedSales) };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not configured.");
  await mongoose.connect(process.env.MONGO_URI);
  const result = apply ? await mongoose.connection.transaction((session) => seed(session)) : await seed(null);
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", database: mongoose.connection.name,
    refundMarker: marker, today: anchorDate, week: `${dateKey(weekStart)} to ${anchorDate}`,
    lastMonth: `${dateKey(lastMonthStart)} to ${dateKey(new Date(lastMonthEnd.getTime() - dayMs))}`, ...result }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
