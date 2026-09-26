const PurchaseOrder = require("../models/PurchaseOrder");

const Supplier = require("../models/Supplier");

const Branch = require("../models/Branch");

const Product = require("../models/Product");

const BranchInventory = require("../models/BranchInventory");

const InventoryTransaction = require("../models/InventoryTransaction");
const { fail, positiveQuantity, runStockOperation, sendStockError } = require("../lib/stockOperations");

// =========================
// GENERATE PO NUMBER
// =========================

const generatePONumber = async () => {
  const count = await PurchaseOrder.countDocuments();

  const number = String(count + 1).padStart(4, "0");

  return `PO-${number}`;
};

// =========================
// GET PURCHASE ORDERS
// =========================

const getPurchaseOrders = async (req, res) => {
  try {
    const orders = await PurchaseOrder.find(
      req.user?.role === "SUPER_ADMIN" ? {} : { branch: req.user?.branch?._id },
    )
      .populate("supplier", "name code")
      .populate("branch", "name code")
      .populate("createdBy", "name email role")
      .populate("items.product", "name sku unit")
      .sort({
        createdAt: -1,
      });

    res.json(orders);
  } catch (error) {
    console.error("Get purchase orders error:", error);

    res.status(500).json({
      message: "Failed to retrieve purchase orders.",
    });
  }
};

// =========================
// GET ONE PURCHASE ORDER
// =========================

const getPurchaseOrderById = async (req, res) => {
  try {
    const order = await PurchaseOrder.findOne({
      _id: req.params.id,
      ...(req.user?.role === "SUPER_ADMIN"
        ? {}
        : { branch: req.user?.branch?._id }),
    })
      .populate("supplier", "name code contactPerson phone")
      .populate("branch", "name code")
      .populate("createdBy", "name email role")
      .populate("items.product", "name sku barcode unit");

    if (!order) {
      return res.status(404).json({
        message: "Purchase order not found.",
      });
    }

    res.json(order);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to retrieve purchase order.",
    });
  }
};

// =========================
// CREATE PURCHASE ORDER
// =========================

const createPurchaseOrder = async (req, res) => {
  try {
    const { supplier, branch, items, expectedDeliveryDate, notes } = req.body;

    if (!supplier || !branch) {
      return res.status(400).json({
        message: "Supplier and branch are required.",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "At least one product is required.",
      });
    }

    const supplierExists = await Supplier.findById(supplier);

    if (!supplierExists || !supplierExists.isActive) {
      return res.status(400).json({
        message: "Supplier does not exist or is inactive.",
      });
    }

    const branchExists = await Branch.findById(branch);

    if (!branchExists || !branchExists.isActive) {
      return res.status(400).json({
        message: "Branch does not exist or is inactive.",
      });
    }

    let totalAmount = 0;

    const orderItems = [];

    for (const item of items) {
      if (!item.product || !item.quantity || !item.unitCost) {
        return res.status(400).json({
          message: "Each item requires product, quantity, and unit cost.",
        });
      }

      const product = await Product.findById(item.product);

      if (!product || !product.isActive) {
        return res.status(400).json({
          message:
            "One of the selected products does not exist or is inactive.",
        });
      }

      const quantity = Number(item.quantity);

      const unitCost = Number(item.unitCost);

      const subtotal = quantity * unitCost;

      totalAmount += subtotal;

      orderItems.push({
        product: item.product,

        quantity,

        unitCost,

        receivedQuantity: 0,

        subtotal,
      });
    }

    const poNumber = await generatePONumber();

    const order = await PurchaseOrder.create({
      poNumber,

      supplier,

      branch,

      items: orderItems,

      totalAmount,

      status: "DRAFT",

      expectedDeliveryDate,

      notes,

      createdBy: req.user._id,
    });

    const populatedOrder = await order.populate([
      {
        path: "supplier",
        select: "name code",
      },
      {
        path: "branch",
        select: "name code",
      },
      {
        path: "createdBy",
        select: "name email role",
      },
      {
        path: "items.product",
        select: "name sku unit",
      },
    ]);

    res.status(201).json(populatedOrder);
  } catch (error) {
    console.error("Create purchase order error:", error);

    res.status(500).json({
      message: "Failed to create purchase order.",
    });
  }
};

// =========================
// UPDATE PO STATUS
// =========================

const updatePurchaseOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const allowedStatuses = ["DRAFT", "ORDERED", "CANCELLED"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid status change.",
      });
    }
    const order = await PurchaseOrder.findOne({
      _id: req.params.id,
      ...(req.user?.role === "SUPER_ADMIN"
        ? {}
        : { branch: req.user?.branch?._id }),
    });

    if (!order) {
      return res.status(404).json({
        message: "Purchase order not found.",
      });
    }

    if (order.status === "RECEIVED" || order.status === "PARTIALLY_RECEIVED") {
      return res.status(400).json({
        message: "A received purchase order cannot be changed to this status.",
      });
    }

    order.status = status;

    await order.save();

    res.json(order);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to update purchase order.",
    });
  }
};

// =========================
// RECEIVE PURCHASE ORDER
// =========================

const receivePurchaseOrder = async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) fail(400, "Received items are required.");

    const result = await runStockOperation(req, `purchase-receipt:${req.params.id}`, async (session) => {
      const order = await PurchaseOrder.findOne({
        _id: req.params.id,
        ...(req.user?.role === "SUPER_ADMIN" ? {} : { branch: req.user?.branch?._id }),
      }).session(session);
      if (!order) fail(404, "Purchase order not found.");
      if (order.status === "CANCELLED") fail(400, "Cancelled purchase orders cannot be received.");
      if (order.status === "RECEIVED") fail(400, "Purchase order has already been fully received.");

      const seen = new Set();
      const receipts = items.map((receivedItem) => {
        const itemId = String(receivedItem.itemId || "").trim();
        if (!itemId) fail(400, "Purchase order item ID is required.");
        const orderItem = order.items.id(itemId);
        if (!orderItem) fail(400, "Purchase order item not found.");
        const lineId = String(orderItem._id);
        if (seen.has(lineId)) fail(400, "A purchase order item can appear only once per receipt.");
        seen.add(lineId);
        const receiveQuantity = positiveQuantity(receivedItem.quantity, "Received quantity must be greater than zero.");
        const remainingQuantity = orderItem.quantity - (orderItem.receivedQuantity || 0);
        if (receiveQuantity > remainingQuantity) {
          fail(409, `Cannot receive more than the remaining quantity for ${orderItem.product}.`);
        }
        return { orderItem, receiveQuantity };
      });

      for (const { orderItem, receiveQuantity } of receipts) {
        const inventory = await BranchInventory.findOneAndUpdate(
          { branch: order.branch, product: orderItem.product },
          {
            $inc: { quantity: receiveQuantity },
            $setOnInsert: { reservedQuantity: 0, reorderLevel: 5, shelfLocation: "Not assigned" },
          },
          { session, upsert: true, new: true, runValidators: true, setDefaultsOnInsert: false },
        );
        orderItem.receivedQuantity = (orderItem.receivedQuantity || 0) + receiveQuantity;
        await InventoryTransaction.create([{
          product: orderItem.product,
          branch: order.branch,
          type: "STOCK_IN",
          quantity: receiveQuantity,
          previousQuantity: inventory.quantity - receiveQuantity,
          newQuantity: inventory.quantity,
          reason: `Purchase Order ${order.poNumber}`,
          reference: order.poNumber,
          performedBy: req.user._id,
          notes: "Stock received from purchase order.",
        }], { session });
      }

      const fullyReceived = order.items.every((item) => item.receivedQuantity >= item.quantity);
      const partiallyReceived = order.items.some((item) => item.receivedQuantity > 0);
      if (fullyReceived) order.status = "RECEIVED";
      else if (partiallyReceived) order.status = "PARTIALLY_RECEIVED";
      await order.save({ session });

      const purchaseOrder = await PurchaseOrder.findById(order._id).session(session)
        .populate("supplier", "name code")
        .populate("branch", "name code")
        .populate("items.product", "name sku unit");
      return { status: 200, body: { message: "Purchase order received successfully.", purchaseOrder } };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    sendStockError(res, error, "Receive purchase order");
  }
};

module.exports = {
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
};
