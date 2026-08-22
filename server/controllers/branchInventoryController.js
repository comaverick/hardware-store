const BranchInventory = require("../models/BranchInventory");
const Product = require("../models/Product");
const Branch = require("../models/Branch");

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
    const existingInventory = await BranchInventory.findById(req.params.id);

    if (!existingInventory) {
      return res.status(404).json({ message: "Inventory record not found" });
    }

    if (
      req.user?.role !== "SUPER_ADMIN" &&
      String(existingInventory.branch) !== String(req.user?.branch?._id)
    ) {
      return res
        .status(403)
        .json({ message: "You do not have access to this branch." });
    }

    const inventory = await BranchInventory.findByIdAndUpdate(
      req.params.id,
      req.body,
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

// Import multiple new inventory records from a validated row list.
const importInventory = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ message: "No inventory rows were provided." });
    if (rows.length > 1000) return res.status(400).json({ message: "Import is limited to 1,000 rows." });

    const [products, branches] = await Promise.all([
      Product.find({ isActive: true }).select("_id name sku barcode reorderLevel").lean(),
      Branch.find(req.user?.role === "SUPER_ADMIN" ? {} : { _id: req.user?.branch?._id }).select("_id name code").lean(),
    ]);
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

      if (!productKey) errors.push({ line, message: "Product SKU/barcode was not found." });
      else if (!branchKey) errors.push({ line, message: "Branch code/name was not found or is not permitted." });
      else if (!Number.isFinite(quantity) || quantity < 0) errors.push({ line, message: "Quantity must be a number greater than or equal to 0." });
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
            reorderLevel: row.reorderLevel === "" || row.reorderLevel == null ? productKey.reorderLevel ?? 5 : Number(row.reorderLevel),
            shelfLocation: String(row.shelfLocation || "").trim(),
          });
        }
      }
    });

    const existing = await BranchInventory.find({
      $or: validRows.map((row) => ({ branch: row.branch, product: row.product })),
    }).select("branch product").lean();
    const existingKeys = new Set(existing.map((row) => `${row.branch}:${row.product}`));
    const newRows = validRows.filter((row) => !existingKeys.has(`${row.branch}:${row.product}`));
    validRows.forEach((row) => {
      if (existingKeys.has(`${row.branch}:${row.product}`)) errors.push({ line: row.line, message: "Inventory already exists for this product and branch." });
    });

    const previewRows = newRows.map((row) => ({
      line: row.line,
      productName: row.productName,
      sku: row.sku,
      branchName: row.branchName,
      branchCode: row.branchCode,
      quantity: row.quantity,
      reorderLevel: row.reorderLevel,
      shelfLocation: row.shelfLocation,
    }));

    if (req.body?.preview) {
      return res.status(200).json({ preview: true, imported: newRows.length, skipped: validRows.length - newRows.length, errors, previewRows });
    }

    if (newRows.length) {
      await BranchInventory.insertMany(newRows.map(({ line, productName, sku, branchName, branchCode, ...row }) => row), { ordered: false });
    }
    res.status(201).json({ imported: newRows.length, skipped: validRows.length - newRows.length, errors, previewRows });
  } catch (error) {
    console.error("Import inventory error:", error);
    res.status(500).json({ message: "Failed to import inventory." });
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
