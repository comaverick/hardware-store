const express = require("express");

const {
  getSmartRestock,
} = require(
  "../controllers/smartInventoryController"
);

const router = express.Router();

// GET smart restock recommendations
router.get(
  "/:branchId",
  getSmartRestock
);

module.exports = router;