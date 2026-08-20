const InventoryTransaction = require("../models/InventoryTransaction");

const Inventory = require("../models/BranchInventory");

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
    const { inventoryId, quantity, reason, notes } = req.body;

    if (!inventoryId) {
      return res.status(400).json({
        message: "Inventory ID is required.",
      });
    }

    if (!quantity || Number(quantity) <= 0) {
      return res.status(400).json({
        message: "Quantity must be greater than zero.",
      });
    }

    const inventory = await Inventory.findById(inventoryId);

    if (!inventory) {
      return res.status(404).json({
        message: "Inventory record not found.",
      });
    }

    const previousQuantity = inventory.quantity;

    const newQuantity = previousQuantity + Number(quantity);

    inventory.quantity = newQuantity;

    await inventory.save();

    const transaction = await InventoryTransaction.create({
      product: inventory.product,
      branch: inventory.branch,

      type: "STOCK_IN",

      quantity: Number(quantity),

      previousQuantity,

      newQuantity,

      reason: reason || "Stock received",

      notes,

      performedBy: req.user._id,
    });

    const populatedTransaction = await transaction.populate([
      {
        path: "product",
        select: "name sku barcode unit",
      },
      {
        path: "branch",
        select: "name code",
      },
      {
        path: "performedBy",
        select: "name email role",
      },
    ]);

    res.status(201).json({
      message: "Stock received successfully.",
      inventory,
      transaction: populatedTransaction,
    });
  } catch (error) {
    console.error("Receive stock error:", error);

    res.status(500).json({
      message: "Failed to receive stock.",
    });
  }
};

// =========================
// STOCK ADJUSTMENT
// =========================

const adjustStock = async (req, res) => {
  try {
    const { inventoryId, newQuantity, reason, notes } = req.body;

    if (!inventoryId) {
      return res.status(400).json({
        message: "Inventory ID is required.",
      });
    }

    if (newQuantity === undefined || Number(newQuantity) < 0) {
      return res.status(400).json({
        message: "New quantity must be zero or greater.",
      });
    }

    if (!reason) {
      return res.status(400).json({
        message: "Adjustment reason is required.",
      });
    }

    const inventory = await Inventory.findById(inventoryId);

    if (!inventory) {
      return res.status(404).json({
        message: "Inventory record not found.",
      });
    }

    const previousQuantity = inventory.quantity;

    const updatedQuantity = Number(newQuantity);

    if (previousQuantity === updatedQuantity) {
      return res.status(400).json({
        message: "New quantity must be different from the current quantity.",
      });
    }

    inventory.quantity = updatedQuantity;

    await inventory.save();

    const transaction = await InventoryTransaction.create({
      product: inventory.product,
      branch: inventory.branch,

      type: "ADJUSTMENT",

      quantity: Math.abs(updatedQuantity - previousQuantity),

      previousQuantity,

      newQuantity: updatedQuantity,

      reason,

      notes,

      performedBy: req.user._id,
    });

    const populatedTransaction = await transaction.populate([
      {
        path: "product",
        select: "name sku barcode unit",
      },
      {
        path: "branch",
        select: "name code",
      },
      {
        path: "performedBy",
        select: "name email role",
      },
    ]);

    res.json({
      message: "Stock adjusted successfully.",
      inventory,
      transaction: populatedTransaction,
    });
  } catch (error) {
    console.error("Adjust stock error:", error);

    res.status(500).json({
      message: "Failed to adjust stock.",
    });
  }
};

// =========================
// TRANSFER STOCK
// =========================

const transferStock = async (req, res) => {
  try {
    const { fromInventoryId, toInventoryId, quantity, reason, notes } =
      req.body;

    if (!fromInventoryId || !toInventoryId) {
      return res.status(400).json({
        message: "Source and destination inventory are required.",
      });
    }

    if (fromInventoryId === toInventoryId) {
      return res.status(400).json({
        message: "Source and destination cannot be the same.",
      });
    }

    if (!quantity || Number(quantity) <= 0) {
      return res.status(400).json({
        message: "Transfer quantity must be greater than zero.",
      });
    }

    const fromInventory = await Inventory.findById(fromInventoryId);

    const toInventory = await Inventory.findById(toInventoryId);

    if (!fromInventory) {
      return res.status(404).json({
        message: "Source inventory not found.",
      });
    }

    if (!toInventory) {
      return res.status(404).json({
        message: "Destination inventory not found.",
      });
    }

    if (String(fromInventory.product) !== String(toInventory.product)) {
      return res.status(400).json({
        message: "Source and destination must contain the same product.",
      });
    }

    if (fromInventory.quantity < Number(quantity)) {
      return res.status(400).json({
        message: "Insufficient stock at source branch.",
      });
    }

    const transferQuantity = Number(quantity);

    const sourcePrevious = fromInventory.quantity;

    const destinationPrevious = toInventory.quantity;

    const sourceNew = sourcePrevious - transferQuantity;

    const destinationNew = destinationPrevious + transferQuantity;

    fromInventory.quantity = sourceNew;

    toInventory.quantity = destinationNew;

    await fromInventory.save();
    await toInventory.save();

    const transferReference = `TRF-${Date.now()}`;

    const transferOut = await InventoryTransaction.create({
      product: fromInventory.product,
      branch: fromInventory.branch,

      type: "TRANSFER_OUT",

      quantity: transferQuantity,

      previousQuantity: sourcePrevious,

      newQuantity: sourceNew,

      reason: reason || "Branch transfer",

      reference: transferReference,

      notes,

      performedBy: req.user._id,
    });

    const transferIn = await InventoryTransaction.create({
      product: toInventory.product,
      branch: toInventory.branch,

      type: "TRANSFER_IN",

      quantity: transferQuantity,

      previousQuantity: destinationPrevious,

      newQuantity: destinationNew,

      reason: reason || "Branch transfer",

      reference: transferReference,

      notes,

      performedBy: req.user._id,
    });

    res.json({
      message: "Stock transferred successfully.",

      reference: transferReference,

      source: {
        inventoryId: fromInventory._id,
        previousQuantity: sourcePrevious,
        newQuantity: sourceNew,
      },

      destination: {
        inventoryId: toInventory._id,
        previousQuantity: destinationPrevious,
        newQuantity: destinationNew,
      },

      transactions: [transferOut, transferIn],
    });
  } catch (error) {
    console.error("Transfer stock error:", error);

    res.status(500).json({
      message: "Failed to transfer stock.",
    });
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
