const BranchInventory = require("../models/BranchInventory");
const Product = require("../models/Product");
const Branch = require("../models/Branch");

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
        .populate("product", "name sku barcode sellingPrice unit reorderLevel")
        .populate("branch", "name code")
        .sort({ createdAt: -1 })
        .lean(),
      Product.find({ isActive: true })
        .select("name sku barcode sellingPrice unit reorderLevel")
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
        .populate("product", "name sku barcode sellingPrice unit reorderLevel")
        .populate("branch", "name code")
        .sort({ createdAt: -1 })
        .lean(),
      Product.find({ isActive: true })
        .select("name sku barcode sellingPrice unit reorderLevel")
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

module.exports = {
  getInventory,
  getBranchInventory,
  getProductInventory,
  createInventory,
  updateInventory,
};
