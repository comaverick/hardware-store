const express = require("express");

const {
  getInventory,
  getBranchInventory,
  getProductInventory,
  createInventory,
  updateInventory,
  importInventory,
} = require("../controllers/branchInventoryController");

const { protect, authorizeBranch } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", protect, getInventory);

router.get("/branch/:branchId", protect, authorizeBranch, getBranchInventory);

router.get("/product/:productId", protect, getProductInventory);

router.post("/", protect, authorizeBranch, createInventory);
router.post("/import", protect, importInventory);

router.put("/:id", protect, updateInventory);

module.exports = router;
