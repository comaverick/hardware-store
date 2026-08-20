const express = require("express");

const {
  getTransactions,
  getProductTransactions,
  getBranchTransactions,
  receiveStock,
  adjustStock,
  transferStock,
} = require("../controllers/inventoryTransactionController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// =========================
// TRANSACTION HISTORY
// =========================

router.get("/", protect, getTransactions);

router.get("/product/:productId", protect, getProductTransactions);

router.get("/branch/:branchId", protect, getBranchTransactions);

// =========================
// STOCK ACTIONS
// =========================

router.post("/receive", protect, receiveStock);

router.post("/adjust", protect, adjustStock);

router.post("/transfer", protect, transferStock);

module.exports = router;
