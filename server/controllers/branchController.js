const Branch = require("../models/Branch");

// Get all branches
const getBranches = async (req, res) => {
  try {
    const query =
      req.user?.role === "SUPER_ADMIN" ? {} : { _id: req.user?.branch?._id };
    const branches = await Branch.find(query).sort({ createdAt: 1 });

    res.status(200).json(branches);
  } catch (error) {
    res.status(500).json({
      message: "Failed to get branches",
      error: error.message,
    });
  }
};

// Get one branch
const getBranch = async (req, res) => {
  try {
    if (
      req.user?.role !== "SUPER_ADMIN" &&
      req.user?.branch?._id.toString() !== req.params.id
    ) {
      return res
        .status(403)
        .json({ message: "You do not have access to this branch." });
    }

    const branch = await Branch.findById(req.params.id);

    if (!branch) {
      return res.status(404).json({
        message: "Branch not found",
      });
    }

    res.status(200).json(branch);
  } catch (error) {
    res.status(500).json({
      message: "Failed to get branch",
      error: error.message,
    });
  }
};

// Create branch
const createBranch = async (req, res) => {
  try {
    const { name, code, address, phone } = req.body;

    const branch = await Branch.create({
      name,
      code,
      address,
      phone,
    });

    res.status(201).json(branch);
  } catch (error) {
    res.status(500).json({
      message: "Failed to create branch",
      error: error.message,
    });
  }
};

module.exports = {
  getBranches,
  getBranch,
  createBranch,
};
