const express = require("express");
const {
  getUsers,
  createUser,
  updateUser,
} = require("../controllers/userController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect, authorize("SUPER_ADMIN"));
router.get("/", getUsers);
router.post("/", createUser);
router.put("/:id", updateUser);

module.exports = router;
