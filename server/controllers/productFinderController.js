const BranchInventory = require("../models/BranchInventory");
const Product = require("../models/Product");

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const parseAiJson = (text) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const value = fenced ? fenced[1] : text;
  return JSON.parse(value.trim());
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
        model: process.env.OPENAI_VISION_MODEL || "gpt-5.6-luna",
        store: false,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: 'You are guiding a hardware-store cashier who is scanning an unknown item. Return JSON only: {"identifiedName":"what the item appears to be, or an empty string if unclear","description":"brief visible description","keywords":[up to 8 catalogue search terms],"shouldRescan":true or false,"guidance":"one short next camera instruction"}. If the item or its label is unclear, set shouldRescan to true and give one specific instruction such as "Move closer to the label", "Rotate the item to show the front", or "Show the size marking". If you can identify the item category, set shouldRescan to false, name it even if you cannot confirm its brand, and say what detail would improve confidence. Never claim the store has stock.',
            },
            { type: "input_image", image_url: imageData, detail: "low" },
          ],
        }],
      }),
    });

    if (!aiResponse.ok) {
      const error = await aiResponse.json().catch(() => ({}));
      return res.status(502).json({ message: error.error?.message || "The image identification service is unavailable." });
    }

    const aiResult = await aiResponse.json();
    const identification = normalizeIdentification(parseAiJson(aiResult.output_text || "{}"));
    const keywords = identification.keywords;
    const products = await Product.find({ isActive: true }).populate("category", "name");
    const candidates = products
      .map((product) => ({ product, score: scoreProduct(product, keywords) }))
      .filter((candidate) => candidate.score > 0)
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
        .filter((item) => item.available > 0),
    }));

    res.json({
      identifiedName: identification.identifiedName || candidates[0]?.product.name || "",
      description: identification.description || "Possible product matches",
      keywords,
      guidance: identification.guidance,
      shouldRescan: identification.shouldRescan,
      matches,
    });
  } catch (error) {
    console.error("Product finder error:", error);
    res.status(500).json({ message: "Could not identify the item. Try another clear photo." });
  }
};

module.exports = { identifyProduct };
