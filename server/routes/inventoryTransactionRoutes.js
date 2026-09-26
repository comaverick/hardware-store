const express = require("express");

const {
  getTransactions,
  getProductTransactions,
  getBranchTransactions,
  receiveStock,
  adjustStock,
  transferStock,
} = require("../controllers/inventoryTransactionController");

const {
  protect,
  authorize,
  authorizeBranch,
  requireBranchAssignment,
} = require("../middleware/authMiddleware");

const router = express.Router();

// =========================
// TRANSACTION HISTORY
// =========================

router.get("/", protect, getTransactions);

router.get("/product/:productId", protect, getProductTransactions);

router.get(
  "/branch/:branchId",
  protect,
  authorizeBranch,
  getBranchTransactions,
);

// =========================
// STOCK ACTIONS
// =========================

router.post(
  "/receive",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_STAFF"),
  requireBranchAssignment,
  receiveStock,
);

router.post(
  "/adjust",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_STAFF"),
  requireBranchAssignment,
  adjustStock,
);

router.post("/transfer", protect, authorize("SUPER_ADMIN"), transferStock);

module.exports = router;
