const mongoose = require("mongoose");

const reservationSchema = new mongoose.Schema(
  {
    reservationNumber: { type: String, required: true, unique: true },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: { type: Number, required: true, min: 1 },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, trim: true },
    status: {
      type: String,
      enum: ["ACTIVE", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED", "EXPIRED"],
      default: "ACTIVE",
    },
    expiresAt: { type: Date, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    completedAt: Date,
  },
  { timestamps: true },
);

reservationSchema.index({ status: 1, expiresAt: 1 });
reservationSchema.index({ branch: 1, createdAt: -1 });

module.exports = mongoose.model("Reservation", reservationSchema);
