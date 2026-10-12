// Preview: node seedDashboardSales.js --date 2026-10-11
// Insert:  node seedDashboardSales.js --date 2026-10-11 --apply
const mongoose = require("mongoose");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const Branch = require("./models/Branch");
const BranchInventory = require("./models/BranchInventory");
const Product = require("./models/Product");
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
if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate || "") || Number.isNaN(anchor.getTime())
  || new Date(anchor.getTime() + 8 * 3600000).toISOString().slice(0, 10) !== anchorDate) {
  throw new Error("Use --date YYYY-MM-DD.");
}
if (anchorDate > manilaDate) throw new Error("Demo sales cannot be dated in the future.");
const apply = args.includes("--apply");
const prefix = `DEMO-DASH-${anchorDate.replaceAll("-", "")}-`;
const batchFilter = { receiptNumber: { $regex: `^${prefix}` } };
const [year, month] = anchorDate.split("-").map(Number);
const lastMonthStart = new Date(Date.UTC(year, month - 2, 1, -8));
const lastMonthEnd = new Date(Date.UTC(year, month - 1, 1, -8));
const weekStart = new Date(anchor.getTime() - 6 * 86400000);
const tomorrow = new Date(anchor.getTime() + 86400000);
const dateKey = (date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const money = (cents) => cents / 100;
const now = new Date();

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
    const period = (start, end) => {
      const records = branchSales.filter((sale) => sale.createdAt >= start && sale.createdAt < end);
      return {
        transactions: records.length,
        amount: money(records.reduce((sum, sale) => sum + Math.round(sale.totalAmount * 100), 0)),
      };
    };
    return {
      branch: branch.code,
      name: branch.name,
      today: period(anchor, tomorrow),
      week: period(weekStart, tomorrow),
      lastMonth: period(lastMonthStart, lastMonthEnd),
      transactions: branchSales.length,
      unitsReleased: branchSales.reduce((sum, sale) => sum + sale.items.reduce((units, item) => units + item.quantity, 0), 0),
    };
  });
}

async function seed(session) {
  const branches = await Branch.find({ isActive: true }).sort({ code: 1 }).session(session).lean();
  if (!branches.length) throw new Error("No active branches found.");
  const existing = await Sale.find(batchFilter).session(session).lean();
  if (existing.length) {
    return { alreadySeeded: true, inserted: 0, summary: summarize(branches, existing) };
  }
  const actor = await User.findOne({ role: "SUPER_ADMIN", isActive: true }).session(session).select("_id").lean();
  if (!actor) throw new Error("An active super admin is required to audit this import.");
  const products = await Product.find({ isActive: true, sellingPrice: { $gt: 0 } }).session(session).lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const profiles = [
    { monthlyBase: 1, extraEvery: 5, weekBase: 2 },
    { monthlyBase: 1, extraEvery: 3, weekBase: 3 },
    { monthlyBase: 2, extraEvery: 4, weekBase: 4 },
    { monthlyBase: 2, extraEvery: 2, weekBase: 3 },
  ];
  const allSales = [];
  const inventoryUpdates = [];
  const movements = [];
  const audits = [];

  for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
    const branch = branches[branchIndex];
    const cashier = await User.findOne({
      branch: branch._id, role: "CASHIER", isActive: true,
      email: `cashier.${branch.code.toLowerCase()}@hardware-store.local`,
    }).session(session).select("_id").lean();
    if (!cashier) throw new Error(`Missing the demo cashier for ${branch.code}.`);
    const inventories = await BranchInventory.find({ branch: branch._id }).sort({ product: 1 }).session(session).lean();
    // Use at most a quarter of stock above the reorder and reservation thresholds.
    const candidates = inventories.flatMap((inventory) => {
      const product = productMap.get(String(inventory.product));
      const excess = inventory.quantity - (inventory.reservedQuantity || 0) - inventory.reorderLevel;
      const budget = Math.floor(excess * 0.25);
      return product && budget >= 2
        ? [{ inventory, product, budget, originalBudget: budget, currentQuantity: inventory.quantity }]
        : [];
    });
    const profile = profiles[branchIndex % profiles.length];
    const dates = [];
    for (let date = new Date(lastMonthStart); date < lastMonthEnd; date = new Date(date.getTime() + 86400000)) {
      dates.push({ date, count: profile.monthlyBase + ((Number(dateKey(date).slice(-2)) + branchIndex) % profile.extraEvery === 0 ? 1 : 0) });
    }
    for (let day = 0; day < 7; day += 1) {
      dates.push({
        date: new Date(weekStart.getTime() + day * 86400000),
        count: day === 6 ? 3 + branchIndex : profile.weekBase + ((day + branchIndex) % 2),
      });
    }
    const branchSales = [];
    for (const { date, count } of dates) {
      const key = dateKey(date);
      const random = randomFor(`${branch.code}:${key}`);
      for (let index = 0; index < count; index += 1) {
        const items = [];
        const lineCount = 1 + Math.floor(random() * 3);
        const receiptNumber = `${prefix}${branch.code}-${key.replaceAll("-", "")}-${String(index + 1).padStart(2, "0")}`;
        const used = new Set();
        for (let line = 0; line < lineCount; line += 1) {
          const eligible = candidates.filter((candidate) => candidate.budget > 0 && !used.has(String(candidate.product._id)));
          if (!eligible.length) throw new Error(`Not enough safe sample stock for ${branch.code}; nothing was inserted.`);
          const candidate = eligible[Math.floor(random() * eligible.length)];
          const quantity = Math.min(candidate.budget, 1 + Math.floor(random() * 2));
          const priceCents = Math.round(candidate.product.sellingPrice * 100);
          items.push({ product: candidate.product._id, quantity, unitPrice: money(priceCents), subtotal: money(priceCents * quantity) });
          used.add(String(candidate.product._id));
          candidate.budget -= quantity;
          movements.push({
            product: candidate.product._id,
            branch: branch._id,
            type: "STOCK_OUT",
            quantity,
            previousQuantity: candidate.currentQuantity,
            newQuantity: candidate.currentQuantity - quantity,
            reason: "Demo dashboard sale",
            reference: receiptNumber,
            performedBy: actor._id,
            notes: `Sample sale dated ${key} in Asia/Manila, imported for dashboard demonstration.`,
            createdAt: now,
            updatedAt: now,
          });
          candidate.currentQuantity -= quantity;
        }
        const subtotalCents = items.reduce((sum, item) => sum + Math.round(item.subtotal * 100), 0);
        const discountCents = random() < 0.2 ? Math.round(subtotalCents * 0.05) : 0;
        const totalCents = subtotalCents - discountCents;
        const paymentMethod = ["CASH", "GCASH", "CARD"][(index + branchIndex + Number(key.slice(-2))) % 3];
        const paidCents = paymentMethod === "CASH" ? Math.ceil(totalCents / 10000) * 10000 : totalCents;
        // Spread receipts across opening hours; all timestamps must be in the past.
        const minute = Math.round((9 * 60) + (index + 1) * (8 * 60 / (count + 1))) + Math.floor(random() * 12);
        const timestamp = new Date(date.getTime() + minute * 60000);
        if (timestamp > now) throw new Error("The selected date includes future opening hours. Run after closing time or choose an earlier date.");
        const sale = {
          receiptNumber, branch: branch._id, cashier: cashier._id, items,
          subtotal: money(subtotalCents), discount: money(discountCents), totalAmount: money(totalCents),
          paymentMethod, amountPaid: money(paidCents), changeAmount: money(paidCents - totalCents),
          status: "COMPLETED", refundedAmount: 0, refunds: [], createdAt: timestamp, updatedAt: timestamp,
        };
        await new Sale(sale).validate();
        branchSales.push(sale);
      }
    }
    for (const candidate of candidates) {
      const used = candidate.originalBudget - candidate.budget;
      if (!used) continue;
      inventoryUpdates.push({ updateOne: {
        filter: {
          _id: candidate.inventory._id,
          quantity: candidate.inventory.quantity,
          $expr: { $eq: [{ $ifNull: ["$reservedQuantity", 0] }, candidate.inventory.reservedQuantity || 0] },
        },
        update: { $inc: { quantity: -used } },
      } });
    }
    allSales.push(...branchSales);
    audits.push({
      actor: actor._id, action: "SEED DASHBOARD SALES", method: "POST", path: "/scripts/seed-dashboard-sales", statusCode: 201,
      branch: branch._id,
      metadata: { receiptPrefix: prefix, anchorDate, timeZone: "Asia/Manila", sampleData: true, transactions: branchSales.length, cashier: String(cashier._id) },
    });
  }
  for (const movement of movements) await new InventoryTransaction(movement).validate();
  for (const audit of audits) await new AuditLog(audit).validate();
  if (apply) {
    const updated = await BranchInventory.bulkWrite(inventoryUpdates, { session });
    if (updated.modifiedCount !== inventoryUpdates.length) throw new Error("Inventory changed during preparation; the import was rolled back.");
    await Sale.insertMany(allSales, { session });
    await InventoryTransaction.insertMany(movements, { session });
    await AuditLog.insertMany(audits, { session });
    const saved = await Sale.find(batchFilter).session(session).lean();
    if (saved.length !== allSales.length || JSON.stringify(summarize(branches, saved)) !== JSON.stringify(summarize(branches, allSales))) {
      throw new Error("Persisted sales do not match the planned dates and totals; the import was rolled back.");
    }
  }
  return { alreadySeeded: false, inserted: apply ? allSales.length : 0, planned: allSales.length, stockMovements: movements.length, summary: summarize(branches, allSales) };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not configured.");
  await mongoose.connect(process.env.MONGO_URI);
  const result = apply
    ? await mongoose.connection.transaction((session) => seed(session))
    : await seed(null);
  console.log(JSON.stringify({
    mode: apply ? "apply" : "preview", database: mongoose.connection.name,
    receiptPrefix: prefix, today: anchorDate, week: `${dateKey(weekStart)} to ${anchorDate}`,
    lastMonth: `${dateKey(lastMonthStart)} to ${dateKey(new Date(lastMonthEnd.getTime() - 86400000))}`,
    ...result,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
