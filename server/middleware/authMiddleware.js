const jwt = require("jsonwebtoken");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");

const getRequestBranch = (req) =>
  req.params.branchId ||
  req.body?.branch ||
  req.query.branch ||
  req.user?.branch?._id ||
  null;

const attachAuditLog = (req, res) => {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    req.path === "/audit-logs"
  )
    return;

  res.once("finish", () => {
    const bodyKeys = Object.keys(req.body || {}).filter(
      (key) => !["password", "token", "imageData"].includes(key),
    );

    AuditLog.create({
      actor: req.user._id,
      action: `${req.method} ${req.baseUrl}${req.path}`,
      method: req.method,
      path: `${req.baseUrl}${req.path}`,
      statusCode: res.statusCode,
      branch: getRequestBranch(req),
      metadata: { bodyKeys, params: req.params, query: req.query },
    }).catch((error) => console.error("Audit log error:", error.message));
  });
};

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Not authorized. No token provided.",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id)
      .select("-password")
      .populate("branch", "name code");

    if (!user || !user.isActive) {
      return res.status(401).json({
        message: "User not found or inactive.",
      });
    }

    req.user = user;
    attachAuditLog(req, res);

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Not authorized. Invalid or expired token.",
    });
  }
};
const authorizeBranch = (req, res, next) => {
  // Super admins can access all branches
  if (req.user.role === "SUPER_ADMIN") {
    return next();
  }

  const requestedBranchId =
    req.params.branchId || req.body.branch || req.query.branch;

  // User has no assigned branch
  if (!req.user.branch) {
    return res.status(403).json({
      message: "User is not assigned to a branch.",
    });
  }

  // No branch was specified in the request
  if (!requestedBranchId) {
    return res.status(400).json({
      message: "Branch ID is required.",
    });
  }

  if (req.user.branch._id.toString() !== requestedBranchId.toString()) {
    return res.status(403).json({
      message: "You do not have access to this branch.",
    });
  }

  next();
};
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Not authenticated.",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission to perform this action.",
      });
    }

    next();
  };
};

module.exports = {
  protect,
  authorize,
  authorizeBranch,
};
