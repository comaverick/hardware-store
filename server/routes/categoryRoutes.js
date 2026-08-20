const express = require("express");

const {
  getCategories,
  getCategory,
  createCategory,
} = require("../controllers/categoryController");

const router = express.Router();

router.get("/", getCategories);
router.get("/:id", getCategory);
router.post("/", createCategory);

module.exports = router;
