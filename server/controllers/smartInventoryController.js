const Sale = require("../models/Sale");
const BranchInventory = require("../models/BranchInventory");
const Product = require("../models/Product");
const Branch = require("../models/Branch");

// =========================
// GET SMART RESTOCK
// =========================

const getSmartRestock = async (req, res) => {
  try {
    const { branchId } = req.params;

    // =========================
    // CHECK BRANCH
    // =========================

    const branch = await Branch.findById(branchId);

    if (!branch || !branch.isActive) {
      return res.status(404).json({
        message: "Branch does not exist or is inactive.",
      });
    }

    // =========================
    // DATE RANGE
    // =========================

    const now = new Date();

    const sevenDaysAgo = new Date(now);

    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // =========================
    // GET INVENTORY
    // =========================

    const inventories = await BranchInventory.find({
      branch: branchId,
    }).populate("product", "name sku barcode unit sellingPrice isActive");

    // =========================
    // GET RECENT SALES
    // =========================

    const sales = await Sale.find({
      branch: branchId,

      status: "COMPLETED",

      createdAt: {
        $gte: sevenDaysAgo,
        $lte: now,
      },
    }).select("items createdAt");

    // =========================
    // CALCULATE SALES
    // =========================

    const salesMap = {};

    for (const sale of sales) {
      for (const item of sale.items) {
        const productId = item.product.toString();

        if (!salesMap[productId]) {
          salesMap[productId] = 0;
        }

        salesMap[productId] += Number(item.quantity);
      }
    }

    // =========================
    // BUILD RECOMMENDATIONS
    // =========================

    const recommendations = inventories
      .filter((inventory) => inventory.product && inventory.product.isActive)
      .map((inventory) => {
        const product = inventory.product;

        const productId = product._id.toString();

        const currentStock = Number(inventory.quantity);

        const reorderLevel = Number(inventory.reorderLevel);

        const soldLast7Days = salesMap[productId] || 0;

        // =========================
        // AVERAGE DAILY SALES
        // =========================

        const averageDailySales = soldLast7Days / 7;

        // =========================
        // DAYS UNTIL STOCKOUT
        // =========================

        let daysUntilStockout = null;

        if (averageDailySales > 0) {
          daysUntilStockout = currentStock / averageDailySales;
        }

        // =========================
        // RISK
        // =========================

        let risk = "LOW";

        if (currentStock <= 0) {
          risk = "CRITICAL";
        } else if (daysUntilStockout !== null && daysUntilStockout <= 2) {
          risk = "CRITICAL";
        } else if (daysUntilStockout !== null && daysUntilStockout <= 5) {
          risk = "HIGH";
        } else if (currentStock <= reorderLevel) {
          risk = "HIGH";
        } else if (daysUntilStockout !== null && daysUntilStockout <= 10) {
          risk = "MEDIUM";
        }

        // =========================
        // RECOMMENDED ORDER
        // =========================

        /*
            We want enough stock for
            approximately 14 days of
            expected demand.

            We also make sure the
            recommendation gets the
            inventory back above the
            reorder level.
          */

        const fourteenDayDemand = averageDailySales * 14;

        const targetStock = Math.max(
          reorderLevel * 2,
          Math.ceil(fourteenDayDemand),
        );

        const recommendedOrder = Math.max(
          0,
          Math.ceil(targetStock - currentStock),
        );

        return {
          product: {
            _id: product._id,
            name: product.name,
            sku: product.sku,
            barcode: product.barcode,
            unit: product.unit,
            sellingPrice: product.sellingPrice,
          },

          currentStock,

          reorderLevel,

          soldLast7Days,

          averageDailySales: Number(averageDailySales.toFixed(2)),

          daysUntilStockout:
            daysUntilStockout === null
              ? null
              : Number(daysUntilStockout.toFixed(1)),

          risk,

          recommendedOrder,
        };
      });

    // =========================
    // SORT BY RISK
    // =========================

    const riskPriority = {
      CRITICAL: 1,
      HIGH: 2,
      MEDIUM: 3,
      LOW: 4,
    };

    recommendations.sort((a, b) => riskPriority[a.risk] - riskPriority[b.risk]);

    // =========================
    // RESPONSE
    // =========================

    res.json({
      branch: {
        _id: branch._id,
        name: branch.name,
        code: branch.code,
      },

      period: {
        days: 7,
        from: sevenDaysAgo,
        to: now,
      },

      totalProducts: recommendations.length,

      criticalCount: recommendations.filter((item) => item.risk === "CRITICAL")
        .length,

      highCount: recommendations.filter((item) => item.risk === "HIGH").length,

      mediumCount: recommendations.filter((item) => item.risk === "MEDIUM")
        .length,

      recommendations,
    });
  } catch (error) {
    console.error("Smart restock error:", error);

    res.status(500).json({
      message: "Failed to generate smart restock recommendations.",
    });
  }
};

module.exports = {
  getSmartRestock,
};
