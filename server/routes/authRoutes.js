const express = require("express");

const { registerUser, loginUser } = require("../controllers/authController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", protect, authorize("SUPER_ADMIN"), registerUser);
router.post("/login", loginUser);

module.exports = router;
