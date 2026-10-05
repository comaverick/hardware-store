const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, immutable: true },
    name: { type: String, trim: true, maxlength: 100, default: "" },
    email: { type: String, required: true, lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Customer", customerSchema);
