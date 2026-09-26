const express = require("express");

const {
  getInventory,
  getBranchInventory,
  getProductInventory,
  createInventory,
  updateInventory,
  importInventory,
} = require("../controllers/branchInventoryController");

const {
  protect,
  authorize,
  authorizeBranch,
  requireBranchAssignment,
} = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, getInventory);

router.get("/branch/:branchId", protect, authorizeBranch, getBranchInventory);

router.get("/product/:productId", protect, getProductInventory);

router.post(
  "/",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_STAFF"),
  authorizeBranch,
  createInventory,
);
router.post(
  "/import",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_STAFF"),
  requireBranchAssignment,
  importInventory,
);

router.put(
  "/:id",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_STAFF"),
  requireBranchAssignment,
  updateInventory,
);

module.exports = router;
