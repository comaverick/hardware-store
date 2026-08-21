const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("./models/Product");
const Category = require("./models/Category");

dotenv.config();

const categoryDescriptions = {
  Fasteners: "Nails, screws, bolts, nuts, and other fastening materials.",
  "Hand Tools": "Manual tools for construction, repair, and maintenance.",
  Electrical: "Electrical wires, switches, outlets, and lighting products.",
  Plumbing: "Pipes, fittings, valves, and plumbing supplies.",
  Paint: "Paints, brushes, rollers, and painting supplies.",
  "Power Tools": "Electric and cordless tools for construction and repair.",
  Safety: "Personal protective equipment and workplace safety supplies.",
};

const rows = [
  ["Common Nail 1 inch","FST-NAIL-001","480100000036","Generic","Fasteners","1-inch common nails for light construction and woodwork.",65,85,"kilogram",20],
  ["Drywall Screw 1 inch","FST-DRYW-001","480100000037","Generic","Fasteners","Fine-thread drywall screws for interior fastening.",95,125,"box",10],
  ["Concrete Screw 2 inch","FST-CONC-002","480100000038","Generic","Fasteners","Masonry screws for fastening into concrete and block.",130,170,"box",10],
  ["Hex Bolt 8mm","FST-BOLT-008","480100000039","Generic","Fasteners","8mm hex bolts for general mechanical applications.",9,14,"piece",30],
  ["Flat Washer 10mm","FST-WASH-010","480100000040","Generic","Fasteners","10mm flat washers for bolts and machine assemblies.",3,5,"piece",50],
  ["Wall Plug 6mm","FST-ANCH-006","480100000041","Generic","Fasteners","6mm plastic wall plugs for masonry mounting.",55,75,"pack",15],
  ["Cable Tie 200mm","FST-TIE-200","480100000042","Generic","Fasteners","200mm nylon cable ties for bundling and organizing wires.",45,65,"pack",15],
  ["Hacksaw Frame","TLS-HACK-001","480100000043","ToolPro","Hand Tools","Adjustable hacksaw frame for cutting metal and plastic.",180,240,"piece",5],
  ["Hacksaw Blade 12 inch","TLS-HACK-B12","480100000044","ToolPro","Hand Tools","Replacement 12-inch hacksaw blade.",35,50,"piece",10],
  ["Tape Measure 5m","TLS-TAPE-005","480100000045","ToolPro","Hand Tools","5-meter retractable tape measure with locking blade.",150,210,"piece",5],
  ["Spirit Level 24 inch","TLS-LEVL-024","480100000046","ToolPro","Hand Tools","24-inch spirit level for accurate alignment.",240,320,"piece",5],
  ["Utility Knife","TLS-KNIF-001","480100000047","ToolPro","Hand Tools","Retractable utility knife for cutting packaging and materials.",75,105,"piece",5],
  ["Utility Knife Blades","TLS-KNIF-B01","480100000048","ToolPro","Hand Tools","Replacement utility knife blades.",40,60,"pack",10],
  ["Cold Chisel 10mm","TLS-CHSL-010","480100000049","ToolPro","Hand Tools","10mm cold chisel for masonry and metalwork.",95,130,"piece",5],
  ["Locking Pliers 10 inch","TLS-PLRS-L10","480100000050","ToolPro","Hand Tools","10-inch locking pliers for gripping and clamping.",240,320,"piece",5],
  ["Electrical Tape Black","ELC-TAPE-BLK","480100000051","Generic","Electrical","Black insulating electrical tape for wire repairs.",18,28,"roll",20],
  ["THHN Wire 1.25mm","ELC-WIRE-012","480100000052","Philflex","Electrical","1.25mm THHN electrical wire.",1050,1250,"roll",3],
  ["Duplex Convenience Outlet","ELC-OUTL-002","480100000053","Royu","Electrical","Duplex wall convenience outlet.",85,120,"piece",10],
  ["Two Gang Switch","ELC-SWCH-002","480100000054","Royu","Electrical","Two-gang wall light switch.",105,145,"piece",10],
  ["Circuit Breaker 20A","ELC-BRKR-020","480100000055","Royu","Electrical","20 ampere single-pole circuit breaker.",180,240,"piece",5],
  ["PVC Electrical Conduit 20mm","ELC-CON-020","480100000056","Neltex","Electrical","20mm PVC conduit for protecting electrical wiring.",45,65,"meter",15],
  ["LED Bulb 7W","ELC-BULB-007","480100000057","Firefly","Electrical","7W LED bulb for energy-efficient household lighting.",65,90,"piece",10],
  ["LED Floodlight 20W","ELC-FLOD-020","480100000058","Firefly","Electrical","20W LED floodlight for indoor and outdoor use.",320,420,"piece",5],
  ["PVC Pipe 1 inch","PLB-PIPE-100","480100000059","Neltex","Plumbing","1-inch PVC pipe for water and plumbing applications.",135,175,"meter",10],
  ["PVC Coupler 1/2 inch","PLB-CPLR-012","480100000060","Neltex","Plumbing","1/2-inch PVC straight coupler fitting.",12,18,"piece",15],
  ["PVC Coupler 3/4 inch","PLB-CPLR-034","480100000061","Neltex","Plumbing","3/4-inch PVC straight coupler fitting.",18,25,"piece",15],
  ["PVC Tee 3/4 inch","PLB-TEE-034","480100000062","Neltex","Plumbing","3/4-inch PVC tee fitting.",28,38,"piece",15],
  ["PTFE Thread Seal Tape","PLB-PTFE-001","480100000063","Generic","Plumbing","Thread seal tape for leak-resistant pipe connections.",12,20,"roll",20],
  ["Hose Clamp 1 inch","PLB-CLMP-100","480100000064","Generic","Plumbing","Adjustable stainless hose clamp for secure connections.",25,38,"piece",15],
  ["Flexible Water Hose 1/2 inch","PLB-HOSE-012","480100000065","Generic","Plumbing","Flexible hose for household water connections.",90,125,"meter",10],
  ["Exterior Paint White 1L","PNT-EXTW-001","480100000066","Boysen","Paint","White exterior paint, 1 liter.",290,350,"liter",5],
  ["Primer White 1L","PNT-PRMR-001","480100000067","Boysen","Paint","White surface primer for interior and exterior preparation.",230,285,"liter",5],
  ["Paint Brush 1 inch","PNT-BRSH-001","480100000068","Generic","Paint","1-inch paint brush for trim and detail work.",35,55,"piece",5],
  ["Paint Roller Refill 9 inch","PNT-RLLR-R09","480100000069","Generic","Paint","9-inch replacement roller cover.",75,105,"piece",5],
  ["Paint Tray","PNT-TRAY-001","480100000070","Generic","Paint","Paint tray for roller application.",65,90,"piece",5],
  ["Paint Mixing Stick","PNT-STCK-001","480100000071","Generic","Paint","Wooden mixing sticks for paint preparation.",20,35,"pack",10],
  ["Cordless Drill 18V","PWR-DRIL-018","480100000072","Bosch","Power Tools","18V cordless drill for heavy-duty construction and repair.",3850,4500,"piece",2],
  ["Cordless Drill Bit Set","PWR-BITS-001","480100000073","Bosch","Power Tools","Mixed drill bit set for wood, metal, and masonry.",420,560,"set",3],
  ["Grinding Disc 4 inch","PWR-DISC-004","480100000074","Bosch","Power Tools","4-inch abrasive grinding disc for angle grinders.",55,80,"piece",15],
  ["Cutting Disc 4 inch","PWR-CUTD-004","480100000075","Bosch","Power Tools","4-inch metal cutting disc for angle grinders.",35,55,"piece",15],
  ["Jigsaw Blade Set","PWR-JBLA-001","480100000076","Bosch","Power Tools","Replacement jigsaw blades for wood and metal.",180,240,"set",3],
  ["Extension Cord 10m","PWR-EXTC-010","480100000077","Generic","Power Tools","10-meter extension cord for tools and equipment.",380,520,"piece",5],
  ["Dust Mask","SAF-MASK-001","480100000078","Generic","Safety","Disposable dust masks for workshop and construction use.",45,70,"pack",10],
  ["Reflective Safety Vest","SAF-VEST-001","480100000079","Generic","Safety","High-visibility reflective vest for worksite safety.",180,250,"piece",5],
  ["Ear Protection Muffs","SAF-EARM-001","480100000080","Generic","Safety","Hearing protection earmuffs for noisy work areas.",220,300,"piece",5],
  ["Safety Boots","SAF-BOOT-001","480100000081","Generic","Safety","Protective work boots with reinforced toe protection.",850,1100,"piece",3],
  ["Knee Protection Pads","SAF-KNEE-001","480100000082","Generic","Safety","Protective knee pads for flooring and construction work.",260,350,"set",3],
  ["Work Apron","SAF-APRN-001","480100000083","Generic","Safety","Durable work apron with pockets for tools.",230,320,"piece",5],
  ["Silicone Sealant 300ml","PLB-SEAL-300","480100000084","Generic","Plumbing","Clear silicone sealant for waterproof joints and gaps.",95,135,"piece",10],
  ["Wood Glue 250ml","PNT-GLUE-250","480100000085","Generic","Paint","General-purpose wood adhesive for repairs and carpentry.",85,120,"piece",10],
];

const seedAdditionalProducts = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const categoryMap = {};

    for (const [name, description] of Object.entries(categoryDescriptions)) {
      const category = await Category.findOneAndUpdate(
        { name },
        { $setOnInsert: { name, description } },
        { new: true, upsert: true },
      );
      categoryMap[name] = category._id;
    }

    const productData = rows.map(([name, sku, barcode, brand, category, description, costPrice, sellingPrice, unit, reorderLevel]) => ({
      name, sku, barcode, brand, category: categoryMap[category], description,
      costPrice, sellingPrice, unit, reorderLevel, isActive: true,
    }));

    const skus = productData.map((product) => product.sku);
    const existing = await Product.find({ sku: { $in: skus } }).select("sku").lean();
    const existingSkus = new Set(existing.map((product) => product.sku));
    const newProducts = productData.filter((product) => !existingSkus.has(product.sku));

    if (newProducts.length > 0) {
      await Product.insertMany(newProducts, { ordered: true });
    }

    console.log(JSON.stringify({
      requested: productData.length,
      added: newProducts.length,
      skipped: productData.length - newProducts.length,
      message: "Existing products and transactions were not modified.",
    }, null, 2));
  } catch (error) {
    console.error("Additional product seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

seedAdditionalProducts();

