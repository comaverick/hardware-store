const express = require("express");
const {
  getReservations,
  createReservation,
  updateReservationStatus,
} = require("../controllers/reservationController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect);
router.get("/", getReservations);
router.post("/", createReservation);
router.patch("/:id/status", updateReservationStatus);

module.exports = router;