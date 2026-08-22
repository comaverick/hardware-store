const mongoose = require("mongoose");

let lastError = null;
let lastAttemptAt = null;
let reconnectTimer = null;
let connecting = false;

const scheduleReconnect = () => {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectDB();
  }, 10000);
};

const connectDB = async () => {
  if (connecting || mongoose.connection.readyState === 1) return;

  connecting = true;
  lastAttemptAt = new Date().toISOString();

  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not configured");
    }

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log("MongoDB connected successfully");
    lastError = null;
  } catch (error) {
    lastError = error.message;
    console.error("MongoDB connection failed:", error.message);
    scheduleReconnect();
  } finally {
    connecting = false;
  }
};

mongoose.connection.on("disconnected", () => {
  lastError = "MongoDB connection lost";
  scheduleReconnect();
});

mongoose.connection.on("error", (error) => {
  lastError = error.message;
});

const getDatabaseStatus = () => {
  const stateNames = ["disconnected", "connected", "connecting", "disconnecting"];
  const state = stateNames[mongoose.connection.readyState] || "unknown";

  return {
    status: state,
    ready: state === "connected",
    lastError,
    lastAttemptAt,
  };
};

module.exports = { connectDB, getDatabaseStatus };
