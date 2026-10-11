const express = require("express");
const { getCustomers } = require("../controllers/customerController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.get("/", getCustomers);

module.exports = router;
