const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Category = require("./models/Category");

dotenv.config();

const categories = [
  {
    name: "Power Tools",
    description: "Electric and battery-powered tools",
  },
  {
    name: "Hand Tools",
    description: "Manual tools and equipment",
  },
  {
    name: "Electrical",
    description: "Electrical supplies and accessories",
  },
  {
    name: "Plumbing",
    description: "Pipes, fittings, valves, and plumbing supplies",
  },
  {
    name: "Paint",
    description: "Paints, coatings, brushes, and painting supplies",
  },
  {
    name: "Fasteners",
    description: "Screws, bolts, nuts, nails, and related hardware",
  },
  {
    name: "Construction Materials",
    description: "General construction and building materials",
  },
  {
    name: "Safety Equipment",
    description: "Personal protective equipment and safety supplies",
  },
];

const seedCategories = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected");

    await Category.deleteMany();

    await Category.insertMany(categories);

    console.log("Categories created successfully");

    process.exit(0);
  } catch (error) {
    console.error("Category seed failed:");
    console.error(error.message);

    process.exit(1);
  }
};

seedCategories();