const express = require("express");
const { askAssistant } = require("../controllers/assistantController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", protect, askAssistant);

module.exports = router;
