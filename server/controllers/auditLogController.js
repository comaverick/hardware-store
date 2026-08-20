const AuditLog = require("../models/AuditLog");

const getAuditLogs = async (req, res) => {
  try {
    const query = {};
    if (req.user.role !== "SUPER_ADMIN") query.branch = req.user.branch?._id;
    if (req.query.branch && req.user.role === "SUPER_ADMIN")
      query.branch = req.query.branch;
    if (req.query.actor) query.actor = req.query.actor;

    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit) || 100, 500))
      .populate("actor", "name email role")
      .populate("branch", "name code")
      .lean();

    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve audit logs." });
  }
};

module.exports = { getAuditLogs };
