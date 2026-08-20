const express = require("express");
const { protect, authorize } = require("../middleware/authMiddleware");

const {
  getBranches,
  getBranch,
  createBranch,
} = require("../controllers/branchController");

const router = express.Router();

router.get("/", protect, getBranches);

router.get("/:id", protect, getBranch);

router.post("/", protect, authorize("SUPER_ADMIN"), createBranch);

module.exports = router;
