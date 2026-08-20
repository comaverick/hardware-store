const mongoose = require("mongoose");
const dotenv = require("dotenv");

const Product = require("./models/Product");
const Branch = require("./models/Branch");
const BranchInventory = require("./models/BranchInventory");
const Sale = require("./models/Sale");
const InventoryTransaction = require("./models/InventoryTransaction");

dotenv.config();

const resetDemoData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("Connected to MongoDB");
    console.log("Starting demo data reset...\n");

    // =====================================================
    // 1. CLEAR DUMMY SALES
    // =====================================================

    const salesResult = await Sale.deleteMany({});

    console.log(
      `Deleted ${salesResult.deletedCount} sales.`
    );

    // =====================================================
    // 2. CLEAR INVENTORY TRANSACTIONS
    // =====================================================

    const transactionResult =
      await InventoryTransaction.deleteMany({});

    console.log(
      `Deleted ${transactionResult.deletedCount} inventory transactions.`
    );

    // =====================================================
    // 3. CLEAR CURRENT BRANCH INVENTORY
    // =====================================================

    const inventoryResult =
      await BranchInventory.deleteMany({});

    console.log(
      `Deleted ${inventoryResult.deletedCount} branch inventory records.`
    );

    // =====================================================
    // 4. GET ACTIVE BRANCHES
    // =====================================================

    const branches = await Branch.find({
      isActive: true,
    }).select("_id name code");

    if (branches.length === 0) {
      throw new Error(
        "No active branches found."
      );
    }

    console.log(
      `\nFound ${branches.length} active branch(es):`
    );

    branches.forEach((branch) => {
      console.log(
        `- ${branch.name} (${branch.code})`
      );
    });

    // =====================================================
    // 5. GET ACTIVE PRODUCTS
    // =====================================================

    const products = await Product.find({
      isActive: true,
    }).select(
      "_id name sku reorderLevel"
    );

    if (products.length === 0) {
      throw new Error(
        "No active products found."
      );
    }

    console.log(
      `\nFound ${products.length} active products.`
    );

    // =====================================================
    // 6. CREATE FRESH BRANCH INVENTORY
    // =====================================================

    const inventoryRecords = [];

    for (const branch of branches) {
      for (let i = 0; i < products.length; i++) {
        const product = products[i];

        /*
         * Generate different but realistic
         * stock levels for demonstration.
         */

        let quantity;

        if (i % 13 === 0) {
          // Critical / very low stock
          quantity = 2;
        } else if (i % 9 === 0) {
          // Low stock
          quantity = 5;
        } else if (i % 7 === 0) {
          // Moderate stock
          quantity = 12;
        } else {
          // Normal stock
          quantity = 25 + (i % 6) * 10;
        }

        const reorderLevel =
          product.reorderLevel || 5;

        const aisle =
          String.fromCharCode(
            65 + (i % 6)
          );

        const shelf =
          String((i % 5) + 1).padStart(
            2,
            "0"
          );

        inventoryRecords.push({
          branch: branch._id,
          product: product._id,
          quantity,
          reorderLevel,
          shelfLocation: `${aisle}-${shelf}`,
        });
      }
    }

    // =====================================================
    // 7. INSERT INVENTORY
    // =====================================================

    if (inventoryRecords.length > 0) {
      await BranchInventory.insertMany(
        inventoryRecords
      );
    }

    console.log(
      `\nCreated ${inventoryRecords.length} branch inventory records.`
    );

    // =====================================================
    // SUMMARY
    // =====================================================

    console.log("\n================================");
    console.log("DEMO DATA RESET COMPLETE");
    console.log("================================");

    console.log(
      `Products kept: ${products.length}`
    );

    console.log(
      `Branches used: ${branches.length}`
    );

    console.log(
      `Inventory records: ${inventoryRecords.length}`
    );

    console.log("Sales: 0");
    console.log("Inventory transactions: 0");

    console.log(
      "\nYour product IDs were preserved."
    );

    await mongoose.connection.close();

    console.log(
      "MongoDB connection closed."
    );
  } catch (error) {
    console.error(
      "\nReset error:",
      error
    );

    await mongoose.connection.close();

    process.exit(1);
  }
};

resetDemoData();