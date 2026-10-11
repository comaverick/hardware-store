const mongoose = require("mongoose");

module.exports = mongoose.model("CustomerScanBudget", new mongoose.Schema({
  _id: String,
  usedBytes: { type: Number, required: true, default: 0, min: 0 },
}));
