const path = require("node:path");
const mongoose = require("mongoose");
const { paintColors, paintFinishes, floorFinishes } = require("../customer/src/features/scanspace/finishCatalog.json");
const Product = require("./models/Product");
const Category = require("./models/Category");
const Branch = require("./models/Branch");
const Inventory = require("./models/BranchInventory");

const STARTING_STOCK = 20;

function finishProducts() {
  const base = { brand: "ScanSpace", costPrice: 0, reorderLevel: 5, isActive: true };
  return [
    ...paintColors.flatMap(color => paintFinishes.map(finish => ({
      ...base,
      name: `${color.name} interior paint · ${finish} · 4 L`,
      sku: `PNT-SS-${color.id}-${finish}-4L`.toUpperCase(),
      categoryName: "Paint",
      image: `/assets/scanspace/paint-${color.id}.png`,
      description: `Presentation catalog: ${color.name.toLowerCase()} ${finish.toLowerCase()} interior paint for walls and ceilings. Sold as one 4 L can.`,
      sellingPrice: 980,
      unit: "piece",
      scanSpace: {
        enabled: true, materialType: "paint", color: color.color, paintFinish: finish,
        coveragePerLiter: 10, packageVolume: 4, recommendedCoats: 2,
        variantGroup: `scanspace-${color.id}-${finish.toLowerCase()}`,
      },
    }))),
    ...floorFinishes.map(finish => ({
      ...base,
      name: `${finish.name} ${finish.kind.toLowerCase()} flooring · ${finish.id === "stone" ? "1.44" : "2.2"} m² box`,
      sku: `FLR-SS-${finish.id}`.toUpperCase(),
      categoryName: "Flooring",
      image: `/assets/scanspace/floor-${finish.id}.png`,
      description: `Presentation catalog: ${finish.name.toLowerCase()} ${finish.kind.toLowerCase()} flooring. One box covers ${finish.id === "stone" ? "1.44" : "2.2"} m² before cutting allowance.`,
      sellingPrice: finish.id === "stone" ? 720 : 1600,
      unit: "box",
      scanSpace: {
        enabled: true, materialType: finish.kind.toLowerCase(), color: finish.color,
        floorFinishId: finish.id, coveragePerPack: finish.id === "stone" ? 1.44 : 2.2,
        tileSize: finish.id === "stone" ? 0.6 : 0.22, wastePercentage: 0.1,
      },
    })),
  ];
}

async function seed({ apply = false } = {}) {
  const definitions = finishProducts();
  const branches = await Branch.find({ isActive: true }).select("_id name").lean();
  if (!branches.length) throw new Error("Create an active pickup branch before adding presentation stock.");
  const existing = await Product.find({ sku: { $in: definitions.map(product => product.sku) } }).select("_id sku image").lean();
  const existingSkus = new Set(existing.map(product => product.sku));
  const report = { mode: apply ? "apply" : "preview", productsToAdd: definitions.length - existing.length,
    existingProducts: existing.length, branchCount: branches.length, startingStock: STARTING_STOCK,
    paintCanPrice: 980, flooringBoxPrices: [720, 1600], inventoryAdded: 0,
    productsNeedingImages: existing.filter(product => !product.image).length, imagesAdded: 0 };
  if (!apply) return report;
  await mongoose.connection.transaction(async session => {
    report.productsAdded = 0;
    report.inventoryAdded = 0;
    report.imagesAdded = 0;
    const categories = new Map();
    for (const name of ["Paint", "Flooring"]) {
      const category = await Category.findOneAndUpdate({ name },
        { $setOnInsert: { name, description: `${name} supplies and finishes.`, isActive: true } },
        { upsert: true, returnDocument: "after", session });
      categories.set(name, category._id);
    }
    for (const { categoryName, ...definition } of definitions) {
      const product = await Product.findOneAndUpdate({ sku: definition.sku },
        { $setOnInsert: { ...definition, category: categories.get(categoryName) } },
        { upsert: true, returnDocument: "after", runValidators: true, session });
      if (!existingSkus.has(product.sku)) report.productsAdded++;
      if (!product.image) {
        const updated = await Product.updateOne({ _id: product._id,
          $or: [{ image: { $exists: false } }, { image: "" }, { image: null }] },
        { $set: { image: definition.image } }, { runValidators: true, session });
        report.imagesAdded += updated.modifiedCount;
      }
      for (const branch of branches) {
        const inventory = await Inventory.updateOne({ product: product._id, branch: branch._id },
          { $setOnInsert: { quantity: STARTING_STOCK, reservedQuantity: 0, reorderLevel: 5, shelfLocation: "ScanSpace finishes" } },
          { upsert: true, runValidators: true, session });
        report.inventoryAdded += inventory.upsertedCount;
      }
    }
  });
  return report;
}

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
  (async () => {
    try {
      if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing from server/.env.");
      await mongoose.connect(process.env.MONGO_URI);
      console.log(JSON.stringify(await seed({ apply: process.argv.includes("--apply") }), null, 2));
    } catch (error) {
      console.error("ScanSpace finish seed failed:", error.message);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
}

module.exports = { finishProducts, seed };
