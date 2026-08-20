const BranchInventory = require("../models/BranchInventory");
const Product = require("../models/Product");

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const parseAiJson = (text) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const value = fenced ? fenced[1] : text;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  return JSON.parse((start >= 0 && end > start ? value.slice(start, end + 1) : value).trim());
};

const firstText = (...values) => values.find((value) => typeof value === "string" && value.trim())?.trim() || "";

const normalizeIdentification = (value) => ({
  identifiedName: firstText(value.identifiedName, value.productName, value.itemName, value.name),
  description: firstText(value.description, value.itemDescription),
  guidance: firstText(value.guidance, value.nextStep, value.instruction) || "Take a clear photo of the item and its label.",
  shouldRescan: Boolean(value.shouldRescan ?? value.needsRescan),
  keywords: Array.isArray(value.keywords ?? value.searchTerms)
    ? (value.keywords ?? value.searchTerms).filter((keyword) => typeof keyword === "string").slice(0, 8)
    : [],
});

const identificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["identifiedName", "description", "keywords", "shouldRescan", "guidance"],
  properties: {
    identifiedName: { type: "string", minLength: 2 },
    description: { type: "string" },
    keywords: { type: "array", items: { type: "string" }, maxItems: 8 },
    shouldRescan: { type: "boolean" },
    guidance: { type: "string" },
  },
};

const scoreProduct = (product, keywords) => {
  const haystack = [
    product.name,
    product.brand,
    product.sku,
    product.barcode,
    product.category?.name,
    product.description,
    product.unit,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return keywords.reduce((score, keyword) => {
    const term = String(keyword).toLowerCase().trim();
    if (!term || term.length < 2) return score;
    if (haystack.includes(term)) return score + (product.name.toLowerCase().includes(term) ? 5 : 2);
    return score;
  }, 0);
};

const identifyProduct = async (req, res) => {
  try {
    const { imageData } = req.body;

    if (!imageData || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imageData)) {
      return res.status(400).json({ message: "Provide a JPG, PNG, or WebP image." });
    }

    const base64 = imageData.split(",")[1] || "";
    if (Buffer.byteLength(base64, "base64") > MAX_IMAGE_BYTES) {
      return res.status(413).json({ message: "Image is too large. Use an image under 6 MB." });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        message: "Product Finder is not configured. Add OPENAI_API_KEY to the server environment.",
      });
    }

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || "gpt-4o",
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "hardware_product_identification",
            strict: true,
            schema: identificationSchema,
          },
        },
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: 'You are guiding a hardware-store cashier who is scanning an unknown item. Always provide the best visible item name or broad hardware category, even without a label or brand. For example, call visible hand tools "combination pliers", "needle-nose pliers", "adjustable wrench", "claw hammer", or "screwdriver" when appropriate. Never use generic phrases like "Possible product matches", "unknown item", or "cannot identify" as the item name. Set shouldRescan to true only when you cannot name even a broad item category. Once you can identify a broad category such as "pliers", set shouldRescan to false even if the exact subtype, size, or brand remains uncertain. If a rescan is genuinely required, give one short, physical camera instruction: move left/right, center the item, move closer, rotate it, or show a specific feature. Never claim the store has stock.',
            },
            { type: "input_image", image_url: imageData, detail: "high" },
          ],
        }],
      }),
    });

    if (!aiResponse.ok) {
      const error = await aiResponse.json().catch(() => ({}));
      return res.status(502).json({ message: error.error?.message || "The image identification service is unavailable." });
    }

    const aiResult = await aiResponse.json();
    const outputText = aiResult.output_text || (aiResult.output || []).flatMap((item) => item.content || []).map((item) => item.text || item.output_text || "").join(" ") || "{}";
    const identification = normalizeIdentification(parseAiJson(outputText));
    const keywords = [...new Set([...identification.keywords, identification.identifiedName, identification.description].filter(Boolean))].slice(0, 12);
    const products = await Product.find({ isActive: true }).populate("category", "name");
    const candidates = products
      .map((product) => ({ product, score: scoreProduct(product, keywords) }))
      .filter((candidate) => candidate.score >= 3)
      .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
      .slice(0, 5);

    const productIds = candidates.map((candidate) => candidate.product._id);
    const inventory = await BranchInventory.find({ product: { $in: productIds } })
      .populate("branch", "name code")
      .lean();

    const matches = candidates.map(({ product }) => ({
      product: {
        _id: product._id,
        name: product.name,
        brand: product.brand,
        sku: product.sku,
        unit: product.unit,
        sellingPrice: product.sellingPrice,
      },
      availability: inventory
        .filter((item) => String(item.product) === String(product._id))
        .map((item) => ({
          branch: item.branch,
          available: Math.max(item.quantity - (item.reservedQuantity || 0), 0),
          quantity: item.quantity,
        }))
        .filter((item) => item.branch)
        .sort((a, b) => b.available - a.available || a.branch.name.localeCompare(b.branch.name)),
    }));

    const identifiedName = identification.identifiedName || candidates[0]?.product.name || "";
    const needsAnotherScan = !identifiedName;

    res.json({
      identifiedName,
      description: identification.description || "",
      keywords,
      guidance: needsAnotherScan
        ? identification.guidance || "Move closer and keep the item, label, or size marking in the center of the frame."
        : identification.guidance,
      shouldRescan: needsAnotherScan,
      matches,
    });
  } catch (error) {
    console.error("Product finder error:", error);
    res.status(500).json({ message: "Could not identify the item. Try another clear photo." });
  }
};

module.exports = { identifyProduct };





