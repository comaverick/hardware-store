const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    barcode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    brand: {
      type: String,
      trim: true,
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    description: {
      type: String,
      trim: true,
    },

    costPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    unit: {
      type: String,
      required: true,
      enum: [
        "piece",
        "box",
        "pack",
        "meter",
        "kilogram",
        "liter",
        "roll",
        "set",
      ],
    },

    reorderLevel: {
      type: Number,
      default: 5,
      min: 0,
    },

    image: {
      type: String,
    },

    scanSpace: {
      enabled: { type: Boolean, default: false },
      materialType: {
        type: String,
        enum: ["paint", "tile", "wood", "vinyl", "object"],
      },
      color: { type: String, match: /^#[0-9a-f]{6}$/i },
      textureUrl: { type: String, maxlength: 2048 },
      tileSize: { type: Number, min: 0.05, max: 5 },
      coveragePerLiter: { type: Number, min: 0.1, max: 50 },
      recommendedCoats: { type: Number, min: 1, max: 6, default: 2 },
      packageVolume: { type: Number, min: 0.01, max: 100 },
      coveragePerPack: { type: Number, min: 0.01, max: 100 },
      wastePercentage: { type: Number, min: 0, max: 0.5, default: 0.1 },
      variantGroup: { type: String, maxlength: 100 },
      glbModelUrl: { type: String, maxlength: 2048 },
      modelDimensions: {
        width: { type: Number, min: 0.05, max: 20 },
        height: { type: Number, min: 0.05, max: 8 },
        depth: { type: Number, min: 0.05, max: 20 },
      },
      placementType: {
        type: String,
        enum: ["floor", "wall"],
        default: "floor",
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Product", productSchema);
