const mongoose = require("mongoose");

const purchaseOrderItemSchema =
  new mongoose.Schema(
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

      unitCost: {
        type: Number,
        required: true,
        min: 0,
      },

      receivedQuantity: {
        type: Number,
        default: 0,
        min: 0,
      },

      subtotal: {
        type: Number,
        required: true,
        min: 0,
      },
    },
    {
      _id: true,
    }
  );

const purchaseOrderSchema =
  new mongoose.Schema(
    {
      poNumber: {
        type: String,
        required: true,
        unique: true,
      },

      supplier: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Supplier",
        required: true,
      },

      branch: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Branch",
        required: true,
      },

      items: {
        type: [purchaseOrderItemSchema],
        required: true,
        validate: {
          validator: (items) =>
            items.length > 0,
          message:
            "Purchase order must contain at least one item.",
        },
      },

      totalAmount: {
        type: Number,
        required: true,
        min: 0,
      },

      status: {
        type: String,
        enum: [
          "DRAFT",
          "ORDERED",
          "PARTIALLY_RECEIVED",
          "RECEIVED",
          "CANCELLED",
        ],
        default: "DRAFT",
      },

      expectedDeliveryDate: {
        type: Date,
      },

      notes: {
        type: String,
        trim: true,
      },

      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    },
    {
      timestamps: true,
    }
  );

module.exports = mongoose.model(
  "PurchaseOrder",
  purchaseOrderSchema
);