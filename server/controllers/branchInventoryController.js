const BranchInventory = require("../models/BranchInventory");
const Product = require("../models/Product");
const Branch = require("../models/Branch");
const InventoryTransaction = require("../models/InventoryTransaction");
const { branchFilter, getAssignedBranchId } = require("../lib/branchAccess");
const { runStockOperation, sendStockError } = require("../lib/stockOperations");

const normalizeImportValue = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const completeInventoryRecords = (inventory, products, branches) => {
  const existing = new Set(
    inventory.map((item) => String(item.branch?._id) + ":" + String(item.product?._id)),
  );

  const virtualRecords = [];
  branches.forEach((branch) => {
    products.forEach((product) => {
      const key = String(branch._id) + ":" + String(product._id);
      if (existing.has(key)) return;

      virtualRecords.push({
        _id: "virtual-" + String(branch._id) + "-" + String(product._id),
        branch,
        product,
        quantity: 0,
        reservedQuantity: 0,
        reorderLevel: product.reorderLevel ?? 5,
        shelfLocation: null,
        isVirtual: true,
      });
    });
  });

  return [...inventory, ...virtualRecords];
};
// Get inventory for all branches
const getInventory = async (req, res) => {
  try {
    const branchFilter =
      req.user?.role === "SUPER_ADMIN"
        ? {}
        : { branch: req.user?.branch?._id };
    const branchQuery =
      req.user?.role === "SUPER_ADMIN"
        ? {}
        : { _id: req.user?.branch?._id };

    const [inventory, products, branches] = await Promise.all([
      BranchInventory.find(branchFilter)
        .populate("product", "name sku barcode sellingPrice costPrice unit reorderLevel")
        .populate("branch", "name code")
        .sort({ createdAt: -1 })
        .lean(),
      Product.find({ isActive: true })
        .select("name sku barcode sellingPrice costPrice unit reorderLevel")
        .lean(),
      Branch.find(branchQuery).select("name code").lean(),
    ]);

    res.status(200).json(completeInventoryRecords(inventory, products, branches));
  } catch (error) {
    res.status(500).json({
      message: "Failed to get inventory",
      error: error.message,
    });
  }
};
// Get inventory for one branch
const getBranchInventory = async (req, res) => {
  try {
    const [inventory, products, branches] = await Promise.all([
      BranchInventory.find({ branch: req.params.branchId })
        .populate("product", "name sku barcode sellingPrice costPrice unit reorderLevel")
        .populate("branch", "name code")
        .sort({ createdAt: -1 })
        .lean(),
      Product.find({ isActive: true })
        .select("name sku barcode sellingPrice costPrice unit reorderLevel")
        .lean(),
      Branch.find({ _id: req.params.branchId }).select("name code").lean(),
    ]);

    res.status(200).json(completeInventoryRecords(inventory, products, branches));
  } catch (error) {
    res.status(500).json({
      message: "Failed to get branch inventory",
      error: error.message,
    });
  }
};

// Get inventory for one product across all branches
const getProductInventory = async (req, res) => {
  try {
    const inventory = await BranchInventory.find({
      product: req.params.productId,
      ...(req.user?.role === "SUPER_ADMIN"
        ? {}
        : { branch: req.user?.branch?._id }),
    })
      .populate("branch", "name code")
      .populate("product", "name sku sellingPrice unit");

    res.status(200).json(inventory);
  } catch (error) {
    res.status(500).json({
      message: "Failed to get product inventory",
      error: error.message,
    });
  }
};

// Create inventory record
const createInventory = async (req, res) => {
  try {
    const { branch, product, quantity, reorderLevel, shelfLocation } = req.body;

    const existingInventory = await BranchInventory.findOne({
      branch,
      product,
    });

    if (existingInventory) {
      return res.status(400).json({
        message: "Inventory already exists for this product and branch",
      });
    }

    const branchExists = await Branch.findById(branch);

    if (!branchExists) {
      return res.status(404).json({
        message: "Branch not found",
      });
    }

    const productExists = await Product.findById(product);

    if (!productExists) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    const inventory = await BranchInventory.create({
      branch,
      product,
      quantity,
      reorderLevel,
      shelfLocation,
    });

    const populatedInventory = await BranchInventory.findById(inventory._id)
      .populate("product", "name sku barcode sellingPrice unit")
      .populate("branch", "name code");

    res.status(201).json(populatedInventory);
  } catch (error) {
    res.status(500).json({
      message: "Failed to create inventory",
      error: error.message,
    });
  }
};

// Update inventory
const updateInventory = async (req, res) => {
  try {
    const changes = req.body || {};
    const keys = Object.keys(changes);
    if (!keys.length || keys.some((key) => !["reorderLevel", "shelfLocation"].includes(key))) {
      return res.status(400).json({
        message: "Only reorder level and shelf location can be updated here.",
      });
    }

    const inventory = await BranchInventory.findOneAndUpdate(
      { _id: req.params.id, ...branchFilter(req.user) },
      { $set: changes },
      {
        new: true,
        runValidators: true,
      },
    )
      .populate("product", "name sku barcode sellingPrice unit")
      .populate("branch", "name code");

    if (!inventory) {
      return res.status(404).json({
        message: "Inventory record not found",
      });
    }

    res.status(200).json(inventory);
  } catch (error) {
    res.status(500).json({
      message: "Failed to update inventory",
      error: error.message,
    });
  }
};

const prepareInventoryImport = async (rows, user, session = null) => {
  const products = await Product.find({ isActive: true })
    .select("_id name sku barcode reorderLevel").session(session).lean();
  const branches = await Branch.find(user?.role === "SUPER_ADMIN" ? {} : { _id: getAssignedBranchId(user) })
    .select("_id name code").session(session).lean();
  const productByKey = new Map();
  products.forEach((product) => {
    productByKey.set(`sku:${normalizeImportValue(product.sku)}`, product);
    if (product.barcode) productByKey.set(`barcode:${normalizeImportValue(product.barcode)}`, product);
    productByKey.set(`name:${normalizeImportValue(product.name)}`, product);
  });
  const branchByKey = new Map();
  branches.forEach((branch) => {
    branchByKey.set(`code:${normalizeImportValue(branch.code)}`, branch);
    branchByKey.set(`name:${normalizeImportValue(branch.name)}`, branch);
  });

  const errors = [];
  const validRows = [];
  const seen = new Set();
  rows.forEach((row, index) => {
    const line = Number(row.line || index + 2);
    const productIdentifier = row.sku || row.productSku || row.barcode || row.productName || row.product || row.item;
    const productKey = row.productId
      ? products.find((product) => String(product._id) === String(row.productId))
      : productByKey.get(`sku:${normalizeImportValue(productIdentifier)}`) ||
        productByKey.get(`barcode:${normalizeImportValue(productIdentifier)}`) ||
        productByKey.get(`name:${normalizeImportValue(productIdentifier)}`);
    const branchKey = row.branchId
      ? branches.find((branch) => String(branch._id) === String(row.branchId))
      : branchByKey.get(`code:${normalizeImportValue(row.branchCode || row.branch || row.branchName)}`) ||
        branchByKey.get(`name:${normalizeImportValue(row.branch || row.branchName || row.branchCode)}`);
    const quantity = Number(row.quantity);
    const reorderLevel = row.reorderLevel === "" || row.reorderLevel == null
      ? productKey?.reorderLevel ?? 5
      : Number(row.reorderLevel);

    if (!productKey) errors.push({ line, message: "Product SKU/barcode was not found." });
    else if (!branchKey) errors.push({ line, message: "Branch code/name was not found or is not permitted." });
    else if (row.quantity == null || String(row.quantity).trim() === "" || !Number.isFinite(quantity) || quantity < 0) errors.push({ line, message: "Quantity must be a number greater than or equal to 0." });
    else if (!Number.isFinite(reorderLevel) || reorderLevel < 0) errors.push({ line, message: "Reorder level must be a number greater than or equal to 0." });
    else {
      const key = `${branchKey._id}:${productKey._id}`;
      if (seen.has(key)) errors.push({ line, message: "The same product and branch appear more than once in this file." });
      else {
        seen.add(key);
        validRows.push({
          line,
          branch: branchKey._id,
          product: productKey._id,
          productName: productKey.name,
          sku: productKey.sku,
          branchName: branchKey.name,
          branchCode: branchKey.code,
          quantity,
          reorderLevel,
          shelfLocation: String(row.shelfLocation || "").trim(),
        });
      }
    }
  });

  const existing = validRows.length ? await BranchInventory.find({
    $or: validRows.map((row) => ({ branch: row.branch, product: row.product })),
  }).select("branch product quantity reorderLevel shelfLocation").session(session).lean() : [];
  const existingByKey = new Map(existing.map((row) => [`${row.branch}:${row.product}`, row]));

  const previewRows = validRows.map((row) => {
    const inventory = existingByKey.get(`${row.branch}:${row.product}`);
    const previousQuantity = inventory?.quantity ?? 0;
    return {
      line: row.line,
      productName: row.productName,
      sku: row.sku,
      branchName: row.branchName,
      branchCode: row.branchCode,
      action: inventory ? "Add stock" : "Create inventory",
      quantity: row.quantity,
      previousQuantity,
      newQuantity: previousQuantity + row.quantity,
      reorderLevel: inventory?.reorderLevel ?? row.reorderLevel,
      shelfLocation: inventory ? inventory.shelfLocation || "" : row.shelfLocation,
    };
  });
  const updated = previewRows.filter((row) => row.action === "Add stock").length;
  return {
    validRows,
    imported: validRows.length,
    created: validRows.length - updated,
    updated,
    skipped: rows.length - validRows.length,
    errors,
    previewRows,
  };
};

// Import quantities as stock additions, creating missing inventory records.
const importInventory = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ message: "No inventory rows were provided." });
    if (rows.length > 1000) return res.status(400).json({ message: "Import is limited to 1,000 rows." });

    if (req.body?.preview) {
      const { validRows, ...review } = await prepareInventoryImport(rows, req.user);
      return res.status(200).json({ preview: true, ...review });
    }

    const scope = req.user?.role === "SUPER_ADMIN" ? "all" : getAssignedBranchId(req.user);
    const result = await runStockOperation(req, `inventory-import:${scope}`, async (session) => {
      const { validRows, ...review } = await prepareInventoryImport(rows, req.user, session);
      const transactions = [];
      for (const [index, row] of validRows.entries()) {
        const inventory = await BranchInventory.findOneAndUpdate(
          { branch: row.branch, product: row.product },
          {
            $inc: { quantity: row.quantity },
            $setOnInsert: { reservedQuantity: 0, reorderLevel: row.reorderLevel, shelfLocation: row.shelfLocation },
          },
          { session, upsert: true, new: true, runValidators: true, setDefaultsOnInsert: false },
        );
        const previousQuantity = inventory.quantity - row.quantity;
        review.previewRows[index] = {
          ...review.previewRows[index],
          previousQuantity,
          newQuantity: inventory.quantity,
          reorderLevel: inventory.reorderLevel,
          shelfLocation: inventory.shelfLocation || "",
        };
        if (row.quantity > 0) {
          transactions.push({
            product: row.product,
            branch: row.branch,
            type: "STOCK_IN",
            quantity: row.quantity,
            previousQuantity,
            newQuantity: inventory.quantity,
            reason: "Inventory CSV import",
            notes: `Stock added from CSV line ${row.line}.`,
            performedBy: req.user._id,
          });
        }
      }
      if (transactions.length) await InventoryTransaction.insertMany(transactions, { session });
      return { status: 201, body: review };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    sendStockError(res, error, "Import inventory");
  }
};

module.exports = {
  getInventory,
  getBranchInventory,
  getProductInventory,
  createInventory,
  updateInventory,
  importInventory,
};
