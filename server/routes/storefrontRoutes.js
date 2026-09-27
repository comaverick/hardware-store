const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");
require("../models/Category");
const Branch = require("../models/Branch");
const BranchInventory = require("../models/BranchInventory");

function createStorefrontRouter({ ProductModel = Product, BranchModel = Branch, InventoryModel = BranchInventory } = {}) {
  const router = express.Router();

  router.get("/catalog", async (req, res) => {
    try {
      const branchId = req.query.branch || "";
      if (branchId && !mongoose.isValidObjectId(branchId)) {
        return res.status(400).json({ message: "Invalid branch ID." });
      }

      const [products, branches] = await Promise.all([
        ProductModel.find({ isActive: true })
          .select("name sku brand category description sellingPrice unit image")
          .populate("category", "name isActive")
          .sort({ name: 1 })
          .lean(),
        BranchModel.find({ isActive: true })
          .select("_id name code")
          .sort({ name: 1 })
          .lean(),
      ]);

      if (branchId && !branches.some((branch) => String(branch._id) === branchId)) {
        return res.status(404).json({ message: "Branch not found." });
      }

      const inventory = branchId
        ? await InventoryModel.find({
            branch: branchId,
            product: { $in: products.map((product) => product._id) },
          })
            .select("product quantity reservedQuantity")
            .lean()
        : [];
      const availableByProduct = new Map(
        inventory.map((item) => [
          String(item.product),
          Math.max(0, Number(item.quantity || 0) - Number(item.reservedQuantity || 0)),
        ]),
      );

      res.set("Cache-Control", "no-store");
      return res.json({
        branches: branches.map(({ _id, name, code }) => ({ _id, name, code })),
        products: products.map((product) => ({
          _id: product._id,
          name: product.name,
          sku: product.sku,
          brand: product.brand || "",
          category: product.category?.isActive === false
            ? "Other"
            : product.category?.name || "Other",
          description: product.description || "",
          sellingPrice: product.sellingPrice,
          unit: product.unit,
          image: product.image || "",
          availableQuantity: branchId
            ? availableByProduct.get(String(product._id)) || 0
            : null,
        })),
      });
    } catch (error) {
      return res.status(500).json({ message: "Failed to load the store catalog." });
    }
  });

  return router;
}

module.exports = { createStorefrontRouter, router: createStorefrontRouter() };
