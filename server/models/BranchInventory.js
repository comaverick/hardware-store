const mongoose = require("mongoose");

const branchInventorySchema = new mongoose.Schema(
  {
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

    quantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    reservedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    reorderLevel: {
      type: Number,
      default: 5,
      min: 0,
    },

    shelfLocation: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

branchInventorySchema.index({ branch: 1, product: 1 }, { unique: true });

module.exports = mongoose.model("BranchInventory", branchInventorySchema);
