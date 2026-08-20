const express = require("express");

const {
  createSale,
  getSales,
  getSaleById,
} = require("../controllers/saleController");

const { protect, authorizeBranch } = require("../middleware/authMiddleware");

const router = express.Router();

// Get sales
router.get("/", protect, getSales);

// Get one sale
router.get("/:id", protect, getSaleById);

// Complete POS sale
router.post("/", protect, authorizeBranch, createSale);

module.exports = router;
