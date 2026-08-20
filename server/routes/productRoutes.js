const express = require("express");

const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

const {
  protect,
  authorize,
} = require("../middleware/authMiddleware");

const router = express.Router();

// Anyone authenticated can view products
router.get("/", protect, getProducts);
router.get("/:id", protect, getProduct);

// Only administrators and managers can modify products
router.post(
  "/",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER"),
  createProduct
);

router.put(
  "/:id",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER"),
  updateProduct
);

router.delete(
  "/:id",
  protect,
  authorize("SUPER_ADMIN", "ADMIN"),
  deleteProduct
);

module.exports = router;