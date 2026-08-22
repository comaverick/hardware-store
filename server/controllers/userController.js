const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Branch = require("../models/Branch");

const userFields = "name email role branch isActive createdAt updatedAt";

const getUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select(userFields)
      .populate("branch", "name code")
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve users." });
  }
};

const createUser = async (req, res) => {
  try {
    const { name, email, password, role, branch, refundPin } = req.body;
    if (!name || !email || !password || !role) {
      return res
        .status(400)
        .json({ message: "Name, email, password, and role are required." });
    }
    if (refundPin && !/^\d{4,6}$/.test(String(refundPin))) {
      return res.status(400).json({ message: "Refund PIN must contain 4 to 6 digits." });
    }

    if (role !== "SUPER_ADMIN" && !branch) {
      return res
        .status(400)
        .json({ message: "A branch is required for non-super-admin users." });
    }

    if (branch && !(await Branch.exists({ _id: branch, isActive: true }))) {
      return res
        .status(400)
        .json({ message: "The selected branch is not active." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (await User.exists({ email: normalizedEmail })) {
      return res
        .status(409)
        .json({ message: "An account with that email already exists." });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      password: await bcrypt.hash(password, 10),
      ...(refundPin ? { refundPin: await bcrypt.hash(refundPin, 10) } : {}),
      role,
      branch: role === "SUPER_ADMIN" ? null : branch,
    });

    const result = await User.findById(user._id)
      .select(userFields)
      .populate("branch", "name code");
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to create user." });
  }
};

const updateUser = async (req, res) => {
  try {
    const { name, email, role, branch, password, refundPin, isActive } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found." });

    const nextRole = role || user.role;
    if (refundPin && !/^\d{4,6}$/.test(String(refundPin))) {
      return res.status(400).json({ message: "Refund PIN must contain 4 to 6 digits." });
    }
    if (nextRole !== "SUPER_ADMIN" && !(branch || user.branch)) {
      return res
        .status(400)
        .json({ message: "A branch is required for non-super-admin users." });
    }
    if (branch && !(await Branch.exists({ _id: branch, isActive: true }))) {
      return res
        .status(400)
        .json({ message: "The selected branch is not active." });
    }

    if (name) user.name = name;
    if (email) user.email = email.toLowerCase().trim();
    if (role) user.role = role;
    user.branch = nextRole === "SUPER_ADMIN" ? null : branch || user.branch;
    if (typeof isActive === "boolean") user.isActive = isActive;
    if (password) user.password = await bcrypt.hash(password, 10);
    if (refundPin) user.refundPin = await bcrypt.hash(refundPin, 10);
    await user.save();

    const result = await User.findById(user._id)
      .select(userFields)
      .populate("branch", "name code");
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to update user." });
  }
};

module.exports = { getUsers, createUser, updateUser };
