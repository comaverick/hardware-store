const Product = require("../models/Product");
const BranchInventory = require("../models/BranchInventory");
const { branchFilter } = require("../lib/branchAccess");
const { uploadProductImage, deleteProductImage } = require("../lib/productImages");

const editableFields = [
  "name", "sku", "barcode", "brand", "category", "description",
  "costPrice", "sellingPrice", "unit", "reorderLevel", "image", "scanSpace",
];

const productInput = (body = {}) => Object.fromEntries(
  editableFields.filter((field) => Object.hasOwn(body, field)).map((field) => [field, body[field]]),
);

const sendProductError = (res, error, fallback) => {
  if (error.status) return res.status(error.status).json({ message: error.message });
  return res.status(500).json({ message: fallback, error: error.message });
};

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
      ...branchFilter(req.user),
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
  let uploadedImage;
  try {
    const input = productInput(req.body);
    if (req.file) uploadedImage = await uploadProductImage(req.file);

    const product = await Product.create({ ...input, ...uploadedImage });

    req.auditTarget = { id: product._id, name: product.name, sku: product.sku };

    res.status(201).json(product);
  } catch (error) {
    if (uploadedImage) await deleteProductImage(uploadedImage.imagePublicId);
    sendProductError(res, error, "Failed to create product");
  }
};

const updateProduct = async (req, res) => {
  let uploadedImage;
  try {
    const body = req.body || {};
    const removeImage = body.removeImage === true || body.removeImage === "true";
    if (req.file && removeImage) {
      return res.status(400).json({ message: "Choose a new image or remove the current one." });
    }

    const input = productInput(body);
    const imageChangeRequested = !!req.file || removeImage || Object.hasOwn(input, "image");
    const previous = imageChangeRequested ? await Product.findById(req.params.id) : null;
    if (imageChangeRequested && !previous) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (req.file) {
      uploadedImage = await uploadProductImage(req.file);
      Object.assign(input, uploadedImage);
    } else if (removeImage) {
      input.image = "";
      input.imagePublicId = "";
    } else if (Object.hasOwn(input, "image") && input.image !== previous.image) {
      // Preserve JSON clients that set a URL directly, but release the old managed image.
      input.imagePublicId = "";
    }

    const product = await Product.findByIdAndUpdate(req.params.id, input, {
      new: true,
      runValidators: true,
    }).populate("category", "name");

    if (!product) {
      if (uploadedImage) await deleteProductImage(uploadedImage.imagePublicId);
      return res.status(404).json({
        message: "Product not found",
      });
    }

    if (previous?.imagePublicId && previous.imagePublicId !== product.imagePublicId) {
      await deleteProductImage(previous.imagePublicId);
    }

    req.auditTarget = { id: product._id, name: product.name, sku: product.sku };

    res.status(200).json(product);
  } catch (error) {
    if (uploadedImage) await deleteProductImage(uploadedImage.imagePublicId);
    sendProductError(res, error, "Failed to update product");
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
