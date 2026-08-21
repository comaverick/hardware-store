const Product = require("../models/Product");
const Branch = require("../models/Branch");
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

const parseAssistantJson = (text) => {
  const value = String(text || "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  return JSON.parse((start >= 0 && end > start ? value.slice(start, end + 1) : value).trim());
};

const assistantResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "recommendations", "actionPath", "actionLabel"],
  properties: {
    answer: { type: "string" },
    actionPath: { type: "string", enum: ["", "/products", "/inventory", "/pos", "/product-finder"] },
    actionLabel: { type: "string" },
    recommendations: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sku", "reason", "actionPath", "actionLabel"],
        properties: {
          sku: { type: "string" },
          reason: { type: "string" },
          actionPath: {
            type: "string",
            enum: ["/products", "/inventory", "/pos", "/product-finder"],
          },
          actionLabel: { type: "string" },
        },
      },
    },
  },
};
const getManilaDateKey = (value) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(value));

const summarizeSales = (sales, dateOrRange) => {
  const summary = {
    date: typeof dateOrRange === "string" ? dateOrRange : undefined,
    transactionCount: sales.length,
    totalSales: sales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0),
    byBranch: {},
  };

  sales.forEach((sale) => {
    const branchName = sale.branch?.name || "Unknown branch";
    summary.byBranch[branchName] =
      (summary.byBranch[branchName] || 0) + (sale.totalAmount || 0);
  });

  return summary;
};
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

  const [inventory, products, sales, branches] = await Promise.all([
    BranchInventory.find(branchFilter)
      .populate("product", "name sku brand category sellingPrice unit isActive")
      .populate("branch", "name code")
      .lean(),
    Product.find({ isActive: true })
      .populate("category", "name")
      .select("name sku barcode brand category sellingPrice unit reorderLevel")
      .lean(),
    Branch.find(req.user?.role === "SUPER_ADMIN" ? {} : { _id: req.user?.branch?._id })
      .select("name code")
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
    .filter((row) => row.product && row.branch && row.product.isActive !== false)
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

  const inventoryByBranchSku = new Map(
    inventory.map((row) => [
      String(row.branch?._id) + ":" + String(row.product?._id),
      row,
    ]),
  );

  const outOfStockByBranch = branches.map((branch) => {
    const productsOut = products
      .filter((product) => {
        const row = inventoryByBranchSku.get(
          String(branch._id) + ":" + String(product._id),
        );
        const available = row
          ? Math.max((row.quantity || 0) - (row.reservedQuantity || 0), 0)
          : 0;
        return available === 0;
      })
      .map((product) => ({
        product: product.name,
        sku: product.sku,
        category: product.category?.name || "Uncategorized",
        available: 0,
      }));

    return {
      branch: branch.name,
      code: branch.code,
      outOfStockCount: productsOut.length,
      products: productsOut,
    };
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

  const todayKey = getManilaDateKey(new Date());
  const manilaToday = new Date(todayKey + "T00:00:00+08:00");
  const yesterdayKey = getManilaDateKey(new Date(manilaToday.getTime() - 86400000));
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    weekday: "short",
  }).format(manilaToday);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const weekStart = new Date(manilaToday.getTime() - Math.max(weekdayIndex, 0) * 86400000);
  const weekStartKey = getManilaDateKey(weekStart);

  const todaySales = sales.filter((sale) => getManilaDateKey(sale.createdAt) === todayKey);
  const yesterdaySales = sales.filter((sale) => getManilaDateKey(sale.createdAt) === yesterdayKey);
  const thisWeekSales = sales.filter((sale) => {
    const dateKey = getManilaDateKey(sale.createdAt);
    return dateKey >= weekStartKey && dateKey <= todayKey;
  });

  const salesToday = summarizeSales(todaySales, todayKey);
  const salesYesterday = summarizeSales(yesterdaySales, yesterdayKey);
  const salesThisWeek = summarizeSales(thisWeekSales, {
    start: weekStartKey,
    end: todayKey,
  });

  const salesByDate = {};
  const cashierPerformance = {};

  sales.forEach((sale) => {
    const dateKey = getManilaDateKey(sale.createdAt);
    const cashierName = sale.cashier?.name || "Unknown cashier";

    if (!salesByDate[dateKey]) {
      salesByDate[dateKey] = {
        date: dateKey,
        transactionCount: 0,
        totalSales: 0,
        byCashier: {},
      };
    }

    salesByDate[dateKey].transactionCount += 1;
    salesByDate[dateKey].totalSales += sale.totalAmount || 0;
    salesByDate[dateKey].byCashier[cashierName] =
      (salesByDate[dateKey].byCashier[cashierName] || 0) + (sale.totalAmount || 0);

    if (!cashierPerformance[cashierName]) {
      cashierPerformance[cashierName] = {
        cashier: cashierName,
        transactionCount: 0,
        totalSales: 0,
        unitsSold: 0,
      };
    }

    cashierPerformance[cashierName].transactionCount += 1;
    cashierPerformance[cashierName].totalSales += sale.totalAmount || 0;
    cashierPerformance[cashierName].unitsSold += (sale.items || []).reduce(
      (sum, item) => sum + (item.quantity || 0),
      0,
    );
  });

  const cashierLeaderboard = Object.values(cashierPerformance).sort(
    (a, b) => b.totalSales - a.totalSales,
  );
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
    currentDateManila: todayKey,
    products: productCatalog.slice(0, 300),
    salesToday,
    salesYesterday,
    salesThisWeek,
    salesByDate,
    cashierLeaderboard,
    lowStock,
    outOfStockByBranch,
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
          .map(({ role, content }) => ({ role, content }))
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
      "For questions about today, today's sales, or sales so far today, use the salesToday object and currentDateManila. Do not substitute the last 30 days summary.",
      "For yesterday use salesYesterday. For this week or weekly sales use salesThisWeek. These summaries are already calculated in Manila time; do not say data is unavailable when the relevant object is present, including when its totals are zero.",
      "For custom date ranges such as today until last Friday, use the daily salesByDate object and include only dates in the requested range. For questions about who sold the most, use cashierLeaderboard; rank by totalSales unless the user asks for transactions or units sold. Follow-up questions should use the conversation context plus these live summaries.",
      "For out-of-stock questions, use outOfStockByBranch. It includes every active product in every permitted branch, including products with no inventory record. Do not answer none unless every branch has an empty products array. Group the answer by branch and include the product names and SKUs.",
      "Never invent stock, sales, prices, branches, employees, or transactions.",
      "Use Philippine peso formatting such as PHP 1,250. Keep answers easy to scan with short paragraphs or bullets.",
      "The assistant is read-only. Never claim that you created, deleted, edited, reserved, refunded, or reordered anything.",
      "Respect the user's access scope. Do not reveal data outside the supplied scope.",
      "For repair or shopping questions, return up to 6 useful confirmed products from the catalog as recommendations. Use each product SKU exactly as shown in the context. Never recommend a product SKU that is not in the context.",
      "If the user asks what an unknown physical item is, says a customer brought in an item, or asks to identify an item without an exact SKU/barcode/product name, return an empty recommendations array, set actionPath to /product-finder, set actionLabel to Use AI Product Finder, and tell them to scan or photograph the item.",
      "If the user provides an exact SKU, barcode, or exact catalog product name, answer using that item and its real stock. For identification questions, do not show unrelated catalog products.",
      "If the repair or project also needs an item that is not in the catalog, say so clearly under a separate Not in our catalog note. Do not make it look like store stock, and say that it must be sourced elsewhere or added by a manager.",
      "Return JSON matching the response schema. Keep the answer to 1 to 3 short sentences, then let the cards provide the details. Be practical and action-oriented: recommend the best next step instead of giving a long explanation. Keep each recommendation reason to one short sentence.",
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
        text: {
          format: {
            type: "json_schema",
            name: "hardware_store_bolt_response",
            strict: true,
            schema: assistantResponseSchema,
          },
        },
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
    const outputText = getOutputText(result);
    let structured;

    try {
      structured = parseAssistantJson(outputText);
    } catch {
      structured = { answer: outputText, recommendations: [] };
    }

    const catalogBySku = new Map(
      context.products.map((product) => [String(product.sku).toUpperCase(), product]),
    );
    const allowedPaths = new Set(["/products", "/inventory", "/pos", "/product-finder"]);
    const recommendations = (Array.isArray(structured.recommendations)
      ? structured.recommendations
      : []
    )
      .map((recommendation) => {
        const product = catalogBySku.get(String(recommendation.sku || "").toUpperCase());
        if (!product || !allowedPaths.has(recommendation.actionPath)) return null;

        return {
          product: product.product,
          sku: product.sku,
          category: product.category,
          brand: product.brand,
          price: product.price,
          unit: product.unit,
          stock: product.stock,
          reason: String(recommendation.reason || "Recommended for your request."),
          actionPath: recommendation.actionPath,
          actionLabel: String(recommendation.actionLabel || "Open Products"),
        };
      })
      .filter(Boolean);

    const identificationQuestion = /what is this|identify|brought in|product identifier|unknown item|what item/i.test(question);
    const navigationToFinder = /bring me there|take me there|go there|open (the )?product finder|use (the )?product finder/i.test(question);
    const navigationMatch = question.match(/(?:bring me to|take me to|go to|open)(?: the)? (pos|point of sale|products|inventory|product finder)/i);
    const navigationPath = navigationMatch
      ? ({ pos: "/pos", "point of sale": "/pos", products: "/products", inventory: "/inventory", "product finder": "/product-finder" }[navigationMatch[1].toLowerCase()] || "")
      : "";
    const hasExactCatalogMatch = context.products.some((product) => {
      const query = question.toLowerCase();
      return [product.sku, product.barcode, product.product].filter(Boolean).some((value) => query.includes(String(value).toLowerCase()));
    });
    const defaultActionPath = allowedPaths.has(structured.actionPath)
      ? structured.actionPath
      : "";
    const requiresFinder =
      (identificationQuestion || navigationToFinder) && !hasExactCatalogMatch;
    const actionPath = navigationPath || (requiresFinder ? "/product-finder" : defaultActionPath);
    const actionLabel = navigationPath
      ? "Open " + (navigationPath === "/pos"
          ? "POS"
          : navigationPath === "/inventory"
            ? "Inventory"
            : navigationPath === "/products"
              ? "Products"
              : "Product Finder")
      : requiresFinder
        ? "Use AI Product Finder"
        : String(structured.actionLabel || "");
    const answer = String(structured.answer || outputText || "").trim();

    if (!answer) {
      return res.status(502).json({
        message: "The AI Assistant returned an empty response.",
      });
    }

    res.json({
      answer,
      recommendations,
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
