const mongoose = require("mongoose");

const stockOperationSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  key: { type: String, required: true },
  operation: { type: String, required: true },
  requestHash: { type: String, required: true },
  result: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

stockOperationSchema.index({ actor: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("StockOperation", stockOperationSchema);
