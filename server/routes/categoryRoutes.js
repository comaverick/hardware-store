const express = require("express");
const { protect, authorize } = require("../middleware/authMiddleware");

const {
  getCategories,
  getCategory,
  createCategory,
} = require("../controllers/categoryController");

const router = express.Router();

router.get("/", protect, getCategories);
router.get("/:id", protect, getCategory);
router.post("/", protect, authorize("SUPER_ADMIN", "ADMIN"), createCategory);

module.exports = router;
