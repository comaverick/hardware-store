const express = require("express");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const defaultModels = {
  Project: require("../models/ScanSpaceProject"),
  Product: require("../models/Product"),
  Branch: require("../models/Branch"),
  Inventory: require("../models/BranchInventory"),
};
const { normalizeRoom, estimateRoom } = require("../lib/scanspaceDomain");

function createScanSpaceRouter({
  Project,
  Product,
  Branch,
  Inventory,
} = defaultModels) {
  const router = express.Router();
  const publicProject = (p) => ({
    _id: p._id,
    name: p.name,
    room: p.room,
    revision: p.revision,
    updatedAt: p.updatedAt,
    expiresAt: p.expiresAt,
  });
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };
  const id = (value) => {
    if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) {
      const e = new Error("Invalid project or branch ID.");
      e.status = 400;
      throw e;
    }
    return value;
  };

  // Public storefront catalog contains selling data only; no purchase cost or private stock history.
  router.get(
    "/catalog",
    wrap(async (req, res) => {
      const [products, branches] = await Promise.all([
        Product.find({ isActive: true, "scanSpace.enabled": true })
          .select("name sku unit sellingPrice image scanSpace")
          .lean(),
        Branch.find({ isActive: true }).select("name code").lean(),
      ]);
      const inventory = req.query.branch
        ? await Inventory.find({
            branch: id(req.query.branch),
            product: { $in: products.map((p) => p._id) },
          })
            .select("product quantity reservedQuantity")
            .lean()
        : [];
      res.json({ products, branches, inventory });
    }),
  );

  // A 256-bit bearer capability authorizes the visitor's projects. Never use a device fingerprint.
  router.use((req, res, next) => {
    const token = req.get("X-ScanSpace-Key");
    if (!token || !/^[a-f\d]{64}$/i.test(token))
      return res
        .status(401)
        .json({ message: "A valid ScanSpace project key is required." });
    req.ownerHash = crypto.createHash("sha256").update(token).digest("hex");
    next();
  });
  router.get(
    "/projects",
    wrap(async (req, res) =>
      res.json(
        await Project.find({
          ownerHash: req.ownerHash,
          expiresAt: { $gt: new Date() },
        })
          .select("name revision updatedAt expiresAt")
          .sort({ updatedAt: -1 })
          .limit(30)
          .lean(),
      ),
    ),
  );
  router.post(
    "/projects",
    wrap(async (req, res) => {
      const room = normalizeRoom(req.body.room);
      if ((await Project.countDocuments({ ownerHash: req.ownerHash })) >= 30)
        return res
          .status(409)
          .json({ message: "Delete an old project before saving another." });
      const project = await Project.create({
        ownerHash: req.ownerHash,
        name: room.name,
        room,
        expiresAt: new Date(Date.now() + 90 * 86400000),
      });
      res.status(201).json({
        _id: project._id,
        room: project.room,
        revision: project.revision,
        expiresAt: project.expiresAt,
      });
    }),
  );
  router.get(
    "/projects/:id",
    wrap(async (req, res) => {
      const p = await Project.findOne({
        _id: id(req.params.id),
        ownerHash: req.ownerHash,
        expiresAt: { $gt: new Date() },
      }).lean();
      if (!p) return res.status(404).json({ message: "Project not found." });
      res.json(publicProject(p));
    }),
  );
  router.patch(
    "/projects/:id",
    wrap(async (req, res) => {
      const room = normalizeRoom(req.body.room);
      if (!Number.isInteger(req.body.revision))
        return res
          .status(400)
          .json({ message: "Project revision is required." });
      const p = await Project.findOneAndUpdate(
        {
          _id: id(req.params.id),
          ownerHash: req.ownerHash,
          revision: req.body.revision,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            room,
            name: room.name,
            expiresAt: new Date(Date.now() + 90 * 86400000),
          },
          $inc: { revision: 1 },
        },
        { new: true, runValidators: true },
      );
      if (!p)
        return res.status(409).json({
          message: "Project changed or expired. Reload it before saving.",
        });
      res.json(publicProject(p));
    }),
  );
  router.delete(
    "/projects/:id",
    wrap(async (req, res) => {
      const p = await Project.findOneAndDelete({
        _id: id(req.params.id),
        ownerHash: req.ownerHash,
      });
      if (!p) return res.status(404).json({ message: "Project not found." });
      res.status(204).end();
    }),
  );

  async function validatedEstimate(req) {
    const branch = id(req.body.branch);
    if (!(await Branch.exists({ _id: branch, isActive: true }))) {
      const e = new Error("Choose an active pickup branch.");
      e.status = 400;
      throw e;
    }
    const room = normalizeRoom(req.body.room);
    const [products, inventory] = await Promise.all([
      Product.find({ isActive: true, "scanSpace.enabled": true })
        .select("name sku unit sellingPrice scanSpace isActive")
        .lean(),
      Inventory.find({ branch })
        .select("product quantity reservedQuantity")
        .lean(),
    ]);
    // Product size is store-owned too. A tampered client cannot shrink a real cabinet to fit.
    room.placedProducts.forEach((item) => {
      if (item.productId) {
        const p = products.find((p) => String(p._id) === item.productId);
        if (p?.scanSpace?.modelDimensions)
          item.dimensions = p.scanSpace.modelDimensions;
      }
    });
    return { branch, ...estimateRoom(room, products, inventory) };
  }
  router.post(
    "/estimate",
    wrap(async (req, res) => res.json(await validatedEstimate(req))),
  );
  router.post(
    "/cart-lines",
    wrap(async (req, res) => {
      const estimate = await validatedEstimate(req);
      if (!estimate.canAdd)
        return res.status(409).json({
          message:
            "Select products with enough branch stock before adding to your cart.",
          estimate,
        });
      // This only prepares a cart. Stock must be checked/held again by the reservation endpoint.
      res.json({
        ...estimate,
        status: "draft",
        stockReserved: false,
        source: "scanspace",
      });
    }),
  );
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const validation = error instanceof mongoose.Error.ValidationError;
    const unavailable =
      error.name === "MongoServerSelectionError" ||
      error.name === "MongooseServerSelectionError" ||
      /buffering timed out/.test(error.message);
    res
      .status(
        error.status ||
          (unavailable
            ? 503
            : validation || error.constructor === Error
              ? 400
              : 500),
      )
      .json({
        message: unavailable
          ? "Project storage is temporarily unavailable. Your local draft is still available."
          : error.status || validation || error.constructor === Error
            ? error.message
            : "ScanSpace request failed.",
      });
  });
  return router;
}
module.exports = createScanSpaceRouter();
module.exports.createScanSpaceRouter = createScanSpaceRouter;
