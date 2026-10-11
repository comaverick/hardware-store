const mongoose = require("mongoose");

const reservationItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  name: { type: String, required: true },
  sku: String,
  unit: String,
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
}, { _id: false });

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
      required: function () { return this.source !== "CUSTOMER"; },
    },
    quantity: { type: Number, required: function () { return this.source !== "CUSTOMER"; }, min: 1 },
    items: { type: [reservationItemSchema], default: [], validate: {
      validator: function (items) { return this.source !== "CUSTOMER" || (items.length > 0 && items.every((item) => Number.isSafeInteger(item.quantity))); },
      message: "Customer reservations require items with whole quantities.",
    } },
    source: { type: String, enum: ["STAFF", "CUSTOMER"], default: "STAFF" },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: function () { return this.source === "CUSTOMER"; } },
    customerEmail: { type: String, trim: true },
    requestId: { type: String, required: function () { return this.source === "CUSTOMER"; } },
    requestHash: { type: String, required: function () { return this.source === "CUSTOMER"; } },
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
      required: function () { return this.source !== "CUSTOMER"; },
    },
    completedAt: Date,
    sale: { type: mongoose.Schema.Types.ObjectId, ref: "Sale" },
  },
  { timestamps: true },
);

reservationSchema.index({ status: 1, expiresAt: 1 });
reservationSchema.index({ branch: 1, createdAt: -1 });
reservationSchema.index({ customer: 1, createdAt: -1 });
reservationSchema.index({ customer: 1, requestId: 1 }, {
  unique: true,
  partialFilterExpression: { source: "CUSTOMER" },
});

module.exports = mongoose.model("Reservation", reservationSchema);
