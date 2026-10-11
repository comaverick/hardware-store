const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  ownerUid: { type: String, required: true, immutable: true },
  requestKey: { type: String, required: true, immutable: true },
  kind: { type: String, enum: ["scan", "room"], required: true, immutable: true },
  name: { type: String, required: true, maxlength: 120 },
  byteSize: { type: Number, required: true, immutable: true },
  sha256: { type: String, required: true, immutable: true },
  chunkSize: { type: Number, required: true, immutable: true },
  status: { type: String, enum: ["uploading", "ready", "incomplete", "deleting"], default: "uploading" },
  lease: String,
  leaseUntil: Date,
  room: mongoose.Schema.Types.Mixed,
  customization: mongoose.Schema.Types.Mixed,
  revision: { type: Number, default: 1 },
}, { timestamps: true });

schema.index({ ownerUid: 1, requestKey: 1 }, { unique: true });
schema.index({ ownerUid: 1, updatedAt: -1 });
module.exports = mongoose.model("CustomerScan", schema);
