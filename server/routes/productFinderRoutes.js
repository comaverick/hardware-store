const express = require("express");
const { identifyProduct } = require("../controllers/productFinderController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.post("/identify", identifyProduct);

module.exports = router;
