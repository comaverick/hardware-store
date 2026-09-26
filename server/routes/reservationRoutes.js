const express = require("express");
const {
  getReservations,
  lookupReservation,
  createReservation,
  updateReservationStatus,
} = require("../controllers/reservationController");
const { checkoutReservation } = require("../controllers/reservationCheckoutController");
const {
  protect,
  authorizeBranch,
  requireBranchAssignment,
} = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect, requireBranchAssignment);
router.get("/", getReservations);
router.get("/lookup", lookupReservation);
router.post("/", authorizeBranch, createReservation);
router.post("/:id/checkout", authorizeBranch, checkoutReservation);
router.patch("/:id/status", updateReservationStatus);

module.exports = router;
