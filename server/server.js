const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const inventoryTransactionRoutes = require("./routes/inventoryTransactionRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const purchaseOrderRoutes =
  require("./routes/purchaseOrderRoutes");
const saleRoutes =
  require("./routes/saleRoutes");
const smartInventoryRoutes =
  require(
    "./routes/smartInventoryRoutes"
  );
const reservationRoutes = require("./routes/reservationRoutes");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "8mb" }));

connectDB();

app.use("/api/branches", require("./routes/branchRoutes"));
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/inventory", require("./routes/branchInventoryRoutes"));
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/inventory-transactions", inventoryTransactionRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use(
  "/api/purchase-orders",
  purchaseOrderRoutes
);
app.use(
  "/api/sales",
  saleRoutes
);
app.use(
  "/api/smart-inventory",
  smartInventoryRoutes
);
app.use("/api/reservations", reservationRoutes);
app.use("/api/product-finder", require("./routes/productFinderRoutes"));

app.get("/", (req, res) => {
  res.json({
    message: "Hardware Store API is running",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
