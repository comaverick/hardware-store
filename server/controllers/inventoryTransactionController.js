const InventoryTransaction = require("../models/InventoryTransaction");

const Inventory = require("../models/BranchInventory");
const { branchFilter } = require("../lib/branchAccess");
const crypto = require("node:crypto");
const { fail, positiveQuantity, runStockOperation, sendStockError } = require("../lib/stockOperations");

// =========================
// GET ALL TRANSACTIONS
// =========================

const getTransactions = async (req, res) => {
  try {
    const transactions = await InventoryTransaction.find(
      req.user?.role === "SUPER_ADMIN" ? {} : { branch: req.user?.branch?._id },
    )
      .populate("product", "name sku barcode unit")
      .populate("branch", "name code")
      .populate("performedBy", "name email role")
      .sort({
        createdAt: -1,
      });

    res.json(transactions);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to retrieve inventory transactions.",
    });
  }
};

// =========================
// RECEIVE STOCK
// =========================

const receiveStock = async (req, res) => {
  try {
    const { inventoryId, quantity, reason, notes } = req.body || {};
    if (!inventoryId) fail(400, "Inventory ID is required.");
    const receivedQuantity = positiveQuantity(quantity);

    const result = await runStockOperation(req, `receive:${inventoryId}`, async (session) => {
      const inventory = await Inventory.findOneAndUpdate(
        { _id: inventoryId, ...branchFilter(req.user) },
        { $inc: { quantity: receivedQuantity } },
        { new: true, session, runValidators: true },
      );
      if (!inventory) fail(404, "Inventory record not found.");

      const [transaction] = await InventoryTransaction.create([{
        product: inventory.product,
        branch: inventory.branch,
        type: "STOCK_IN",
        quantity: receivedQuantity,
        previousQuantity: inventory.quantity - receivedQuantity,
        newQuantity: inventory.quantity,
        reason: reason || "Stock received",
        notes,
        performedBy: req.user._id,
      }], { session });
      await transaction.populate([
        { path: "product", select: "name sku barcode unit" },
        { path: "branch", select: "name code" },
        { path: "performedBy", select: "name email role" },
      ]);
      return { status: 201, body: { message: "Stock received successfully.", inventory, transaction } };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    sendStockError(res, error, "Receive stock");
  }
};

// =========================
// STOCK ADJUSTMENT
// =========================

const adjustStock = async (req, res) => {
  try {
    const { inventoryId, newQuantity, reason, notes } = req.body || {};
    if (!inventoryId) fail(400, "Inventory ID is required.");
    const updatedQuantity = Number(newQuantity);
    if (newQuantity === undefined || newQuantity === null || newQuantity === "" || !Number.isFinite(updatedQuantity) || updatedQuantity < 0) {
      fail(400, "New quantity must be zero or greater.");
    }
    if (!String(reason || "").trim()) fail(400, "Adjustment reason is required.");

    const result = await runStockOperation(req, `adjust:${inventoryId}`, async (session) => {
      const current = await Inventory.findOne({
        _id: inventoryId,
        ...branchFilter(req.user),
      }).session(session);
      if (!current) fail(404, "Inventory record not found.");
      if (current.quantity === updatedQuantity) {
        fail(400, "New quantity must be different from the current quantity.");
      }
      if (updatedQuantity < (current.reservedQuantity || 0)) {
        fail(409, `Cannot set stock below ${current.reservedQuantity} reserved units.`);
      }

      const inventory = await Inventory.findOneAndUpdate(
        {
          _id: inventoryId,
          ...branchFilter(req.user),
          quantity: current.quantity,
          $expr: { $lte: [{ $ifNull: ["$reservedQuantity", 0] }, updatedQuantity] },
        },
        { $set: { quantity: updatedQuantity } },
        { new: true, session, runValidators: true },
      );
      if (!inventory) fail(409, "Stock or reservations changed. Refresh inventory and try again.");

      const [transaction] = await InventoryTransaction.create([{
        product: inventory.product,
        branch: inventory.branch,
        type: "ADJUSTMENT",
        quantity: Math.abs(updatedQuantity - current.quantity),
        previousQuantity: current.quantity,
        newQuantity: updatedQuantity,
        reason,
        notes,
        performedBy: req.user._id,
      }], { session });
      await transaction.populate([
        { path: "product", select: "name sku barcode unit" },
        { path: "branch", select: "name code" },
        { path: "performedBy", select: "name email role" },
      ]);
      return { status: 200, body: { message: "Stock adjusted successfully.", inventory, transaction } };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    sendStockError(res, error, "Adjust stock");
  }
};

// =========================
// TRANSFER STOCK
// =========================

const transferStock = async (req, res) => {
  try {
    const { fromInventoryId, toInventoryId, quantity, reason, notes } = req.body || {};
    if (!fromInventoryId || !toInventoryId) {
      fail(400, "Source and destination inventory are required.");
    }
    if (String(fromInventoryId) === String(toInventoryId)) {
      fail(400, "Source and destination cannot be the same.");
    }
    const transferQuantity = positiveQuantity(quantity, "Transfer quantity must be greater than zero.");

    const result = await runStockOperation(req, `transfer:${fromInventoryId}:${toInventoryId}`, async (session) => {
      const fromInventory = await Inventory.findById(fromInventoryId).session(session);
      const toInventory = await Inventory.findById(toInventoryId).session(session);
      if (!fromInventory) fail(404, "Source inventory not found.");
      if (!toInventory) fail(404, "Destination inventory not found.");
      if (String(fromInventory.product) !== String(toInventory.product)) {
        fail(400, "Source and destination must contain the same product.");
      }
      if (String(fromInventory.branch) === String(toInventory.branch)) {
        fail(400, "Source and destination must be different branches.");
      }
      if (fromInventory.quantity - (fromInventory.reservedQuantity || 0) < transferQuantity) {
        fail(409, "Insufficient unreserved stock at source branch.");
      }

      const source = await Inventory.findOneAndUpdate(
        {
          _id: fromInventoryId,
          $expr: {
            $gte: [
              { $subtract: ["$quantity", { $ifNull: ["$reservedQuantity", 0] }] },
              transferQuantity,
            ],
          },
        },
        { $inc: { quantity: -transferQuantity } },
        { new: true, session, runValidators: true },
      );
      if (!source) fail(409, "Available stock changed. Refresh inventory and try again.");

      const destination = await Inventory.findOneAndUpdate(
        { _id: toInventoryId, product: source.product },
        { $inc: { quantity: transferQuantity } },
        { new: true, session, runValidators: true },
      );
      if (!destination) fail(409, "Destination inventory changed. Refresh inventory and try again.");

      const transferReference = `TRF-${crypto.randomUUID()}`;
      const transactions = await InventoryTransaction.create([{
        product: source.product,
        branch: source.branch,
        type: "TRANSFER_OUT",
        quantity: transferQuantity,
        previousQuantity: source.quantity + transferQuantity,
        newQuantity: source.quantity,
        reason: reason || "Branch transfer",
        reference: transferReference,
        notes,
        performedBy: req.user._id,
      }, {
        product: destination.product,
        branch: destination.branch,
        type: "TRANSFER_IN",
        quantity: transferQuantity,
        previousQuantity: destination.quantity - transferQuantity,
        newQuantity: destination.quantity,
        reason: reason || "Branch transfer",
        reference: transferReference,
        notes,
        performedBy: req.user._id,
      }], { session });
      return {
        status: 200,
        body: {
          message: "Stock transferred successfully.",
          reference: transferReference,
          source: { inventoryId: source._id, previousQuantity: source.quantity + transferQuantity, newQuantity: source.quantity },
          destination: { inventoryId: destination._id, previousQuantity: destination.quantity - transferQuantity, newQuantity: destination.quantity },
          transactions,
        },
      };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    sendStockError(res, error, "Transfer stock");
  }
};

// =========================
// PRODUCT TRANSACTIONS
// =========================

const getProductTransactions = async (req, res) => {
  try {
    const transactions = await InventoryTransaction.find({
      product: req.params.productId,
      ...(req.user?.role === "SUPER_ADMIN"
        ? {}
        : { branch: req.user?.branch?._id }),
    })
      .populate("product", "name sku barcode unit")
      .populate("branch", "name code")
      .populate("performedBy", "name email role")
      .sort({
        createdAt: -1,
      });

    res.json(transactions);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to retrieve product transactions.",
    });
  }
};

// =========================
// BRANCH TRANSACTIONS
// =========================

const getBranchTransactions = async (req, res) => {
  try {
    const transactions = await InventoryTransaction.find({
      branch: req.params.branchId,
    })
      .populate("product", "name sku barcode unit")
      .populate("branch", "name code")
      .populate("performedBy", "name email role")
      .sort({
        createdAt: -1,
      });

    res.json(transactions);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to retrieve branch transactions.",
    });
  }
};

module.exports = {
  getTransactions,
  getProductTransactions,
  getBranchTransactions,
  receiveStock,
  adjustStock,
  transferStock,
};
