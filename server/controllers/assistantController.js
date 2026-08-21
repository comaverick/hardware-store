const Product = require("../models/Product");
const BranchInventory = require("../models/BranchInventory");
const Sale = require("../models/Sale");

const privilegedRoles = ["SUPER_ADMIN", "ADMIN", "MANAGER"];

const getOutputText = (result) =>
  result.output_text ||
  (result.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || item.output_text || "")
    .join(" ")
    .trim();

const buildScope = (req) => {
  const isPrivileged = privilegedRoles.includes(req.user?.role);
  const branchFilter =
    isPrivileged && req.user.role === "SUPER_ADMIN"
      ? {}
      : { branch: req.user?.branch?._id };
  const saleFilter = { ...branchFilter };

  if (!isPrivileged) {
    saleFilter.cashier = req.user?._id;
  }

  return { isPrivileged, branchFilter, saleFilter };
};

const getAssistantContext = async (req) => {
  const { isPrivileged, branchFilter, saleFilter } = buildScope(req);
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [inventory, products, sales] = await Promise.all([
    BranchInventory.find(branchFilter)
      .populate("product", "name sku brand category sellingPrice unit isActive")
      .populate("branch", "name code")
      .lean(),
    Product.find({ isActive: true })
      .populate("category", "name")
      .select("name sku brand category sellingPrice unit reorderLevel")
      .lean(),
    Sale.find({
      ...saleFilter,
      createdAt: { $gte: since },
      status: "COMPLETED",
    })
      .select("branch cashier totalAmount items createdAt receiptNumber")
      .populate("branch", "name code")
      .populate("cashier", "name")
      .populate("items.product", "name")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
  ]);

  const stockRows = inventory
    .filter((row) => row.product?.isActive !== false)
    .map((row) => ({
      product: row.product.name,
      sku: row.product.sku,
      category: row.product.category?.name || "Uncategorized",
      branch: row.branch?.name || "Unknown branch",
      quantity: row.quantity || 0,
      reserved: row.reservedQuantity || 0,
      available: Math.max((row.quantity || 0) - (row.reservedQuantity || 0), 0),
      reorderLevel: row.reorderLevel ?? row.product.reorderLevel ?? 5,
      price: row.product.sellingPrice,
      unit: row.product.unit,
    }));

  const stockByProduct = new Map();
  stockRows.forEach((row) => {
    const current = stockByProduct.get(row.sku) || {
      product: row.product,
      sku: row.sku,
      totalAvailable: 0,
      branches: [],
    };
    current.totalAvailable += row.available;
    current.branches.push({ branch: row.branch, available: row.available });
    stockByProduct.set(row.sku, current);
  });

  const productCatalog = products.map((product) => ({
    product: product.name,
    sku: product.sku,
    category: product.category?.name || "Uncategorized",
    brand: product.brand || "Unbranded",
    price: product.sellingPrice,
    unit: product.unit,
    stock: stockByProduct.get(product.sku)?.totalAvailable ?? 0,
  }));

  const salesSummary = {
    transactionCount: sales.length,
    totalSales: sales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0),
    byBranch: {},
    topProducts: {},
    recentTransactions: sales.slice(0, 12).map((sale) => ({
      receipt: sale.receiptNumber,
      branch: sale.branch?.name || "Unknown branch",
      cashier: sale.cashier?.name || "Unknown cashier",
      total: sale.totalAmount,
      time: sale.createdAt,
    })),
  };

  sales.forEach((sale) => {
    const branchName = sale.branch?.name || "Unknown branch";
    salesSummary.byBranch[branchName] =
      (salesSummary.byBranch[branchName] || 0) + (sale.totalAmount || 0);

    (sale.items || []).forEach((item) => {
      const name = item.product?.name || String(item.product || "Unknown product");
      salesSummary.topProducts[name] =
        (salesSummary.topProducts[name] || 0) + (item.quantity || 0);
    });
  });

  const lowStock = stockRows
    .filter((row) => row.available <= row.reorderLevel)
    .sort((a, b) => a.available - b.available)
    .slice(0, 80);

  return {
    accessScope: isPrivileged
      ? "This user can access permitted management-level store data."
      : "This user can access only their assigned branch and their own recent sales.",
    user: {
      name: req.user.name,
      role: req.user.role,
      branch: req.user.branch?.name || "No assigned branch",
    },
    products: productCatalog.slice(0, 300),
    lowStock,
    salesLast30Days: salesSummary,
  };
};

const askAssistant = async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    const messages = Array.isArray(req.body?.messages)
      ? req.body.messages
          .filter(
            (message) =>
              ["user", "assistant"].includes(message?.role) &&
              typeof message.content === "string",
          )
          .slice(-8)
      : [];

    if (!question || question.length > 1000) {
      return res.status(400).json({
        message: "Ask a question between 1 and 1000 characters.",
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        message:
          "AI Assistant is not configured. Add OPENAI_API_KEY to the server environment.",
      });
    }

    const context = await getAssistantContext(req);
    const systemPrompt = [
      "You are Hardware Store Bolt, a concise and practical assistant inside a hardware-store management system.",
      "Answer only from the supplied live store context. If the context does not contain the answer, say that you do not have enough data.",
      "Never invent stock, sales, prices, branches, employees, or transactions.",
      "Use Philippine peso formatting such as PHP 1,250. Keep answers easy to scan with short paragraphs or bullets.",
      "The assistant is read-only. Never claim that you created, deleted, edited, reserved, refunded, or reordered anything.",
      "Respect the user's access scope. Do not reveal data outside the supplied scope.",
      "For product advice, clearly label recommendations as recommendations and distinguish them from confirmed store stock.",
      "LIVE STORE CONTEXT:\n" + JSON.stringify(context),
    ].join("\n\n");

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini",
        store: false,
        input: [
          { role: "developer", content: systemPrompt },
          ...messages,
          { role: "user", content: question },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const error = await aiResponse.json().catch(() => ({}));
      return res.status(502).json({
        message:
          error.error?.message || "The AI Assistant service is unavailable.",
      });
    }

    const result = await aiResponse.json();
    const answer = getOutputText(result);

    if (!answer) {
      return res.status(502).json({
        message: "The AI Assistant returned an empty response.",
      });
    }

    res.json({
      answer,
      scope: context.accessScope,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("AI Assistant error:", error);
    res.status(500).json({
      message: "Could not answer that right now. Please try again.",
    });
  }
};

module.exports = { askAssistant };
