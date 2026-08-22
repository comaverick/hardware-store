const mongoose = require("mongoose");

const saleItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    refundedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    _id: true,
  },
);

const saleSchema = new mongoose.Schema(
  {
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
    },

    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
    },

    items: {
      type: [saleItemSchema],
      required: true,
      validate: {
        validator: (items) => items.length > 0,
        message: "Sale must contain at least one item.",
      },
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    discount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    paymentMethod: {
      type: String,
      enum: ["CASH", "GCASH", "CARD"],
      required: true,
    },

    amountPaid: {
      type: Number,
      required: true,
      min: 0,
    },

    changeAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["COMPLETED", "PARTIALLY_REFUNDED", "VOIDED", "REFUNDED"],
      default: "COMPLETED",
    },

    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    refunds: [
      {
        refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        amount: { type: Number, required: true, min: 0 },
        reason: { type: String, trim: true, required: true },
        items: [
          {
            product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
            quantity: { type: Number, required: true, min: 1 },
            amount: { type: Number, required: true, min: 0 },
          },
        ],
        createdAt: { type: Date, default: Date.now },
      },
    ],

    cashier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Sale", saleSchema);
