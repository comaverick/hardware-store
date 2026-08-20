const mongoose = require("mongoose");
const dotenv = require("dotenv");

const Product = require("./models/Product");
const Category = require("./models/Category");

dotenv.config();

const categories = [
  {
    name: "Fasteners",
    description: "Nails, screws, bolts, nuts, and other fastening materials.",
  },
  {
    name: "Hand Tools",
    description: "Manual tools for construction, repair, and maintenance.",
  },
  {
    name: "Electrical",
    description: "Electrical wires, switches, outlets, and lighting products.",
  },
  {
    name: "Plumbing",
    description: "Pipes, fittings, valves, and plumbing supplies.",
  },
  {
    name: "Paint",
    description: "Paints, brushes, rollers, and painting supplies.",
  },
  {
    name: "Power Tools",
    description: "Electric and cordless tools for construction and repair.",
  },
  {
    name: "Safety",
    description: "Personal protective equipment and workplace safety supplies.",
  },
];

const products = [
  // =========================
  // FASTENERS
  // =========================

  {
    name: "Common Nail 2 inch",
    sku: "FST-NAIL-002",
    barcode: "480100000001",
    brand: "Generic",
    category: "Fasteners",
    description: "2-inch common nails for general construction and woodwork.",
    costPrice: 65,
    sellingPrice: 85,
    unit: "kilogram",
    reorderLevel: 20,
  },
  {
    name: "Common Nail 3 inch",
    sku: "FST-NAIL-003",
    barcode: "480100000002",
    brand: "Generic",
    category: "Fasteners",
    description: "3-inch common nails for construction and carpentry.",
    costPrice: 65,
    sellingPrice: 85,
    unit: "kilogram",
    reorderLevel: 20,
  },
  {
    name: "Wood Screw 1 inch",
    sku: "FST-SCRW-001",
    barcode: "480100000003",
    brand: "Generic",
    category: "Fasteners",
    description: "1-inch wood screws for general woodworking.",
    costPrice: 90,
    sellingPrice: 120,
    unit: "box",
    reorderLevel: 10,
  },
  {
    name: "Wood Screw 2 inch",
    sku: "FST-SCRW-002",
    barcode: "480100000004",
    brand: "Generic",
    category: "Fasteners",
    description: "2-inch wood screws for furniture and construction.",
    costPrice: 100,
    sellingPrice: 135,
    unit: "box",
    reorderLevel: 10,
  },
  {
    name: "Hex Bolt 10mm",
    sku: "FST-BOLT-010",
    barcode: "480100000005",
    brand: "Generic",
    category: "Fasteners",
    description: "10mm hex bolts for general mechanical applications.",
    costPrice: 12,
    sellingPrice: 18,
    unit: "piece",
    reorderLevel: 30,
  },
  {
    name: "Hex Nut 10mm",
    sku: "FST-NUT-010",
    barcode: "480100000006",
    brand: "Generic",
    category: "Fasteners",
    description: "10mm hex nuts compatible with standard bolts.",
    costPrice: 5,
    sellingPrice: 8,
    unit: "piece",
    reorderLevel: 30,
  },

  // =========================
  // HAND TOOLS
  // =========================

  {
    name: "Claw Hammer 16oz",
    sku: "TLS-HAMR-016",
    barcode: "480100000007",
    brand: "ToolPro",
    category: "Hand Tools",
    description: "16oz claw hammer for general construction and carpentry.",
    costPrice: 260,
    sellingPrice: 350,
    unit: "piece",
    reorderLevel: 5,
  },
  {
    name: "Flat Screwdriver 6 inch",
    sku: "TLS-SCRD-F06",
    barcode: "480100000008",
    brand: "ToolPro",
    category: "Hand Tools",
    description: "6-inch flat-head screwdriver.",
    costPrice: 85,
    sellingPrice: 120,
    unit: "piece",
    reorderLevel: 5,
  },
  {
    name: "Phillips Screwdriver 6 inch",
    sku: "TLS-SCRD-P06",
    barcode: "480100000009",
    brand: "ToolPro",
    category: "Hand Tools",
    description: "6-inch Phillips-head screwdriver.",
    costPrice: 90,
    sellingPrice: 130,
    unit: "piece",
    reorderLevel: 5,
  },
  {
    name: "Adjustable Wrench 8 inch",
    sku: "TLS-WRCH-A08",
    barcode: "480100000010",
    brand: "ToolPro",
    category: "Hand Tools",
    description: "8-inch adjustable wrench for plumbing and mechanical work.",
    costPrice: 210,
    sellingPrice: 280,
    unit: "piece",
    reorderLevel: 5,
  },
  {
    name: "Long Nose Pliers 6 inch",
    sku: "TLS-PLRS-L06",
    barcode: "480100000011",
    brand: "ToolPro",
    category: "Hand Tools",
    description: "6-inch long nose pliers for electrical and repair work.",
    costPrice: 180,
    sellingPrice: 240,
    unit: "piece",
    reorderLevel: 5,
  },
  {
    name: "Combination Pliers 8 inch",
    sku: "TLS-PLRS-C08",
    barcode: "480100000012",
    brand: "ToolPro",
    category: "Hand Tools",
    description: "8-inch combination pliers for general-purpose use.",
    costPrice: 195,
    sellingPrice: 260,
    unit: "piece",
    reorderLevel: 5,
  },

  // =========================
  // ELECTRICAL
  // =========================

  {
    name: "THHN Wire 2.0mm",
    sku: "ELC-WIRE-020",
    barcode: "480100000013",
    brand: "Philflex",
    category: "Electrical",
    description: "2.0mm THHN electrical wire.",
    costPrice: 1600,
    sellingPrice: 1850,
    unit: "roll",
    reorderLevel: 3,
  },
  {
    name: "THHN Wire 3.5mm",
    sku: "ELC-WIRE-035",
    barcode: "480100000014",
    brand: "Philflex",
    category: "Electrical",
    description: "3.5mm THHN electrical wire.",
    costPrice: 2500,
    sellingPrice: 2950,
    unit: "roll",
    reorderLevel: 3,
  },
  {
    name: "Universal Convenience Outlet",
    sku: "ELC-OUTL-001",
    barcode: "480100000015",
    brand: "Royu",
    category: "Electrical",
    description: "Universal electrical convenience outlet.",
    costPrice: 105,
    sellingPrice: 145,
    unit: "piece",
    reorderLevel: 10,
  },
  {
    name: "Single Gang Switch",
    sku: "ELC-SWCH-001",
    barcode: "480100000016",
    brand: "Royu",
    category: "Electrical",
    description: "Single gang wall switch.",
    costPrice: 70,
    sellingPrice: 95,
    unit: "piece",
    reorderLevel: 10,
  },
  {
    name: "LED Bulb 9W",
    sku: "ELC-BULB-009",
    barcode: "480100000017",
    brand: "Firefly",
    category: "Electrical",
    description: "9W LED bulb for household lighting.",
    costPrice: 80,
    sellingPrice: 110,
    unit: "piece",
    reorderLevel: 10,
  },
  {
    name: "LED Bulb 12W",
    sku: "ELC-BULB-012",
    barcode: "480100000018",
    brand: "Firefly",
    category: "Electrical",
    description: "12W LED bulb for household lighting.",
    costPrice: 105,
    sellingPrice: 145,
    unit: "piece",
    reorderLevel: 10,
  },

  // =========================
  // PLUMBING
  // =========================

  {
    name: "PVC Pipe 1/2 inch",
    sku: "PLB-PIPE-012",
    barcode: "480100000019",
    brand: "Neltex",
    category: "Plumbing",
    description: "1/2-inch PVC pipe for water and plumbing applications.",
    costPrice: 70,
    sellingPrice: 95,
    unit: "meter",
    reorderLevel: 10,
  },
  {
    name: "PVC Pipe 3/4 inch",
    sku: "PLB-PIPE-034",
    barcode: "480100000020",
    brand: "Neltex",
    category: "Plumbing",
    description: "3/4-inch PVC pipe for water and plumbing applications.",
    costPrice: 95,
    sellingPrice: 125,
    unit: "meter",
    reorderLevel: 10,
  },
  {
    name: "PVC Elbow 1/2 inch",
    sku: "PLB-ELBW-012",
    barcode: "480100000021",
    brand: "Neltex",
    category: "Plumbing",
    description: "1/2-inch PVC elbow fitting.",
    costPrice: 18,
    sellingPrice: 25,
    unit: "piece",
    reorderLevel: 15,
  },
  {
    name: "PVC Elbow 3/4 inch",
    sku: "PLB-ELBW-034",
    barcode: "480100000022",
    brand: "Neltex",
    category: "Plumbing",
    description: "3/4-inch PVC elbow fitting.",
    costPrice: 25,
    sellingPrice: 35,
    unit: "piece",
    reorderLevel: 15,
  },
  {
    name: "PVC Tee 1/2 inch",
    sku: "PLB-TEE-012",
    barcode: "480100000023",
    brand: "Neltex",
    category: "Plumbing",
    description: "1/2-inch PVC tee fitting.",
    costPrice: 20,
    sellingPrice: 28,
    unit: "piece",
    reorderLevel: 15,
  },
  {
    name: "PVC Ball Valve 1/2 inch",
    sku: "PLB-VALV-012",
    barcode: "480100000024",
    brand: "Neltex",
    category: "Plumbing",
    description: "1/2-inch PVC ball valve.",
    costPrice: 80,
    sellingPrice: 110,
    unit: "piece",
    reorderLevel: 5,
  },

  // =========================
  // PAINT
  // =========================

  {
    name: "Interior Latex Paint White 1L",
    sku: "PNT-LTXW-001",
    barcode: "480100000025",
    brand: "Boysen",
    category: "Paint",
    description: "White interior latex paint, 1 liter.",
    costPrice: 270,
    sellingPrice: 320,
    unit: "liter",
    reorderLevel: 5,
  },
  {
    name: "Interior Latex Paint White 4L",
    sku: "PNT-LTXW-004",
    barcode: "480100000026",
    brand: "Boysen",
    category: "Paint",
    description: "White interior latex paint, 4 liters.",
    costPrice: 820,
    sellingPrice: 980,
    unit: "liter",
    reorderLevel: 5,
  },
  {
    name: "Paint Brush 2 inch",
    sku: "PNT-BRSH-002",
    barcode: "480100000027",
    brand: "Generic",
    category: "Paint",
    description: "2-inch paint brush for general painting.",
    costPrice: 60,
    sellingPrice: 85,
    unit: "piece",
    reorderLevel: 5,
  },
  {
    name: "Paint Roller 9 inch",
    sku: "PNT-RLLR-009",
    barcode: "480100000028",
    brand: "Generic",
    category: "Paint",
    description: "9-inch paint roller for walls and large surfaces.",
    costPrice: 130,
    sellingPrice: 180,
    unit: "piece",
    reorderLevel: 5,
  },
  {
    name: "Paint Thinner 1L",
    sku: "PNT-THNR-001",
    barcode: "480100000029",
    brand: "Generic",
    category: "Paint",
    description: "1-liter paint thinner.",
    costPrice: 110,
    sellingPrice: 150,
    unit: "liter",
    reorderLevel: 5,
  },

  // =========================
  // POWER TOOLS
  // =========================

  {
    name: "Cordless Drill 12V",
    sku: "PWR-DRIL-012",
    barcode: "480100000030",
    brand: "Bosch",
    category: "Power Tools",
    description: "12V cordless drill for general construction and repair.",
    costPrice: 2100,
    sellingPrice: 2450,
    unit: "piece",
    reorderLevel: 2,
  },
  {
    name: "Angle Grinder 4 inch",
    sku: "PWR-GRND-004",
    barcode: "480100000031",
    brand: "Bosch",
    category: "Power Tools",
    description: "4-inch angle grinder for cutting and grinding.",
    costPrice: 1550,
    sellingPrice: 1850,
    unit: "piece",
    reorderLevel: 2,
  },
  {
    name: "Circular Saw 7 inch",
    sku: "PWR-SAWC-007",
    barcode: "480100000032",
    brand: "Bosch",
    category: "Power Tools",
    description: "7-inch circular saw for cutting wood.",
    costPrice: 2750,
    sellingPrice: 3250,
    unit: "piece",
    reorderLevel: 2,
  },

  // =========================
  // SAFETY
  // =========================

  {
    name: "Work Gloves",
    sku: "SAF-GLOV-001",
    barcode: "480100000033",
    brand: "Generic",
    category: "Safety",
    description: "Protective work gloves for general construction tasks.",
    costPrice: 50,
    sellingPrice: 75,
    unit: "piece",
    reorderLevel: 10,
  },
  {
    name: "Safety Goggles",
    sku: "SAF-GOGL-001",
    barcode: "480100000034",
    brand: "Generic",
    category: "Safety",
    description: "Protective safety goggles for construction and workshop use.",
    costPrice: 85,
    sellingPrice: 120,
    unit: "piece",
    reorderLevel: 5,
  },
  {
    name: "Hard Hat",
    sku: "SAF-HHAT-001",
    barcode: "480100000035",
    brand: "Generic",
    category: "Safety",
    description: "Protective hard hat for construction work.",
    costPrice: 210,
    sellingPrice: 280,
    unit: "piece",
    reorderLevel: 5,
  },
];

const seedProducts = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("Connected to MongoDB");

    // =========================
    // CREATE / FIND CATEGORIES
    // =========================

    const categoryMap = {};

    for (const categoryData of categories) {
      const category = await Category.findOneAndUpdate(
        { name: categoryData.name },
        {
          $setOnInsert: categoryData,
        },
        {
          new: true,
          upsert: true,
        },
      );

      categoryMap[category.name] = category._id;

      console.log(`Category ready: ${category.name}`);
    }

    // =========================
    // PREPARE PRODUCTS
    // =========================

    const productData = products.map((product) => ({
      ...product,
      category: categoryMap[product.category],
    }));

    // =========================
    // CHECK EXISTING PRODUCTS
    // =========================

    const existingProducts = await Product.find({
      sku: {
        $in: productData.map((product) => product.sku),
      },
    }).select("sku");

    const existingSkuSet = new Set(
      existingProducts.map((product) => product.sku),
    );

    const newProducts = productData.filter(
      (product) => !existingSkuSet.has(product.sku),
    );

    // =========================
    // INSERT
    // =========================

    if (newProducts.length === 0) {
      console.log("All seed products already exist.");

      await mongoose.connection.close();

      return;
    }

    await Product.insertMany(newProducts);

    console.log(`Added ${newProducts.length} new products.`);

    console.log(
      `Skipped ${productData.length - newProducts.length} existing products.`,
    );

    await mongoose.connection.close();
  } catch (error) {
    console.error("Seed error:", error);

    await mongoose.connection.close();

    process.exit(1);
  }
};

seedProducts();
