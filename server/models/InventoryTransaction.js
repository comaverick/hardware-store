const mongoose = require("mongoose");

const inventoryTransactionSchema =
  new mongoose.Schema(
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
      },

      branch: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Branch",
        required: true,
      },

      type: {
        type: String,
        enum: [
          "STOCK_IN",
          "STOCK_OUT",
          "ADJUSTMENT",
          "TRANSFER_IN",
          "TRANSFER_OUT",
        ],
        required: true,
      },

      quantity: {
        type: Number,
        required: true,
        min: 0,
      },

      previousQuantity: {
        type: Number,
        required: true,
        min: 0,
      },

      newQuantity: {
        type: Number,
        required: true,
        min: 0,
      },

      reason: {
        type: String,
        trim: true,
      },

      reference: {
        type: String,
        trim: true,
      },

      performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      notes: {
        type: String,
        trim: true,
      },
    },
    {
      timestamps: true,
    }
  );

module.exports = mongoose.model(
  "InventoryTransaction",
  inventoryTransactionSchema
);