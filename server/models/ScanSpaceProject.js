const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    ownerHash: { type: String, required: true, index: true, select: false },
    name: { type: String, required: true, maxlength: 100 },
    room: { type: mongoose.Schema.Types.Mixed, required: true },
    revision: { type: Number, default: 1 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);
module.exports = mongoose.model("ScanSpaceProject", schema);
