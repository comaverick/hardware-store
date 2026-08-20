const express = require("express");

const {
  getInventory,
  getBranchInventory,
  getProductInventory,
  createInventory,
  updateInventory,
} = require("../controllers/branchInventoryController");

const { protect, authorizeBranch } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, getInventory);

router.get("/branch/:branchId", protect, authorizeBranch, getBranchInventory);

router.get("/product/:productId", protect, getProductInventory);

router.post("/", protect, authorizeBranch, createInventory);

router.put("/:id", protect, updateInventory);

module.exports = router;
