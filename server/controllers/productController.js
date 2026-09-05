const Product = require("../models/Product");
const BranchInventory = require("../models/BranchInventory");

const getProducts = async (req, res) => {
  try {
    const products = await Product.find({ isActive: true })
      .populate("category", "name")
      .sort({ createdAt: -1 });

    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({
      message: "Failed to get products",
      error: error.message,
    });
  }
};

const getProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      "category",
      "name",
    );

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    const inventory = await BranchInventory.find({
      product: product._id,
    }).populate("branch", "name code");

    res.status(200).json({
      product,
      inventory,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to get product",
      error: error.message,
    });
  }
};

const createProduct = async (req, res) => {
  try {
    const {
      name,
      sku,
      barcode,
      brand,
      category,
      description,
      costPrice,
      sellingPrice,
      unit,
      reorderLevel,
      image,
      scanSpace,
    } = req.body;

    const product = await Product.create({
      name,
      sku,
      barcode,
      brand,
      category,
      description,
      costPrice,
      sellingPrice,
      unit,
      reorderLevel,
      image,
      scanSpace,
    });

    req.auditTarget = { id: product._id, name: product.name, sku: product.sku };

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({
      message: "Failed to create product",
      error: error.message,
    });
  }
};

const updateProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate("category", "name");

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    req.auditTarget = { id: product._id, name: product.name, sku: product.sku };

    res.status(200).json(product);
  } catch (error) {
    res.status(500).json({
      message: "Failed to update product",
      error: error.message,
    });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true },
    );

    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    req.auditTarget = { id: product._id, name: product.name, sku: product.sku };

    res.status(200).json({
      message: "Product deactivated successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to deactivate product",
      error: error.message,
    });
  }
};

module.exports = {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
};
