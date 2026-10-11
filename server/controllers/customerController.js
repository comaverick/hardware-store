const Customer = require("../models/Customer");

const positiveInteger = (value, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= maximum
    ? number
    : null;
};

const getCustomers = async (req, res) => {
  res.set("Cache-Control", "no-store");

  const page = positiveInteger(req.query.page, 1);
  const pageSize = positiveInteger(req.query.pageSize, 10, 100);
  const search = req.query.search ?? "";
  const status = req.query.status ?? "all";
  const verification = req.query.verification ?? "all";

  if (!page || !pageSize || !Number.isSafeInteger((page - 1) * pageSize)) {
    return res.status(400).json({
      message: "Use a positive page number and a page size between 1 and 100.",
    });
  }
  if (typeof search !== "string" || search.length > 200) {
    return res.status(400).json({ message: "Search must be 200 characters or fewer." });
  }
  if (!["all", "active", "inactive"].includes(status)) {
    return res.status(400).json({ message: "Choose a valid account status." });
  }
  if (!["all", "verified", "unverified"].includes(verification)) {
    return res.status(400).json({ message: "Choose a valid email verification status." });
  }

  const filter = {};
  if (status !== "all") filter.isActive = status === "active";
  if (verification !== "all") filter.emailVerified = verification === "verified";
  if (search.trim()) {
    const literalSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(literalSearch, "i");
    filter.$or = [{ name: pattern }, { email: pattern }];
  }

  try {
    const [customers, total] = await Promise.all([
      Customer.find(filter)
        .select("name email emailVerified isActive createdAt updatedAt")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      Customer.countDocuments(filter),
    ]);

    return res.json({ customers, total, page, pageSize });
  } catch (error) {
    console.error("Get customers error:", error.message);
    return res.status(503).json({
      message: "Customer accounts could not load. Please try again shortly.",
    });
  }
};

module.exports = { getCustomers };
