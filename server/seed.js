const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Branch = require("./models/Branch");

dotenv.config();

const branches = [
  {
    name: "Hardware Store - Branch 1",
    code: "BR-001",
    address: "Branch 1 Address",
    phone: "09123456789",
  },
  {
    name: "Hardware Store - Branch 2",
    code: "BR-002",
    address: "Branch 2 Address",
    phone: "09123456789",
  },
  {
    name: "Hardware Store - Branch 3",
    code: "BR-003",
    address: "Branch 3 Address",
    phone: "09123456789",
  },
  {
    name: "Hardware Store - Branch 4",
    code: "BR-004",
    address: "Branch 4 Address",
    phone: "09123456789",
  },
];

const seedBranches = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected");

    await Branch.deleteMany();

    await Branch.insertMany(branches);

    console.log("4 branches created successfully");

    process.exit(0);
  } catch (error) {
    console.error("Seed failed:");
    console.error(error.message);

    process.exit(1);
  }
};

seedBranches();
