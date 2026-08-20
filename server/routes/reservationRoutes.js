const express = require("express");
const {
  getReservations,
  createReservation,
  updateReservationStatus,
} = require("../controllers/reservationController");
const { protect, authorizeBranch } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect);
router.get("/", getReservations);
router.post("/", authorizeBranch, createReservation);
router.patch("/:id/status", updateReservationStatus);

module.exports = router;
