const express = require("express");

const {
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
} = require("../controllers/purchaseOrderController");

const {
  protect,
  authorize,
  authorizeBranch,
  requireBranchAssignment,
} = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, getPurchaseOrders);

router.get("/:id", protect, getPurchaseOrderById);

router.post("/", protect, authorizeBranch, createPurchaseOrder);

router.put("/:id/status", protect, updatePurchaseOrderStatus);

router.post(
  "/:id/receive",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_STAFF"),
  requireBranchAssignment,
  receivePurchaseOrder,
);

module.exports = router;
