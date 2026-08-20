const express = require("express");

const {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} = require("../controllers/supplierController");

const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, getSuppliers);

router.get("/:id", protect, getSupplierById);

router.post(
  "/",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER"),
  createSupplier,
);

router.put(
  "/:id",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER"),
  updateSupplier,
);

router.delete(
  "/:id",
  protect,
  authorize("SUPER_ADMIN", "ADMIN"),
  deleteSupplier,
);

module.exports = router;
