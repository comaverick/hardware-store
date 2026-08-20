const express = require("express");
const { getAuditLogs } = require("../controllers/auditLogController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.get(
  "/",
  protect,
  authorize("SUPER_ADMIN", "ADMIN", "MANAGER"),
  getAuditLogs,
);

module.exports = router;
