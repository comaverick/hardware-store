const express = require("express");

const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

const { protect, authorize } = require("../middleware/authMiddleware");
const parseProductImage = require("../middleware/productImageUpload");

const router = express.Router();

// Anyone authenticated can view products
router.get("/", protect, getProducts);
router.get("/:id", protect, getProduct);

// Administrators, managers, and inventory staff can manage the catalog.
router.post(
  "/",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_STAFF"),
  parseProductImage,
  createProduct,
);

router.put(
  "/:id",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_STAFF"),
  parseProductImage,
  updateProduct,
);

router.delete(
  "/:id",
  protect,
  authorize("SUPER_ADMIN", "ADMIN"),
  deleteProduct,
);

module.exports = router;
