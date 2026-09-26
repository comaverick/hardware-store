const express = require("express");

const { getSmartRestock } = require("../controllers/smartInventoryController");
const { protect, authorizeBranch } = require("../middleware/authMiddleware");

const router = express.Router();

// GET smart restock recommendations
router.get("/:branchId", protect, authorizeBranch, getSmartRestock);

module.exports = router;
