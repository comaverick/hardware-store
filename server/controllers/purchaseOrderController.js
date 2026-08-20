const PurchaseOrder = require("../models/PurchaseOrder");

const Supplier = require("../models/Supplier");

const Branch = require("../models/Branch");

const Product = require("../models/Product");

const BranchInventory = require("../models/BranchInventory");

const InventoryTransaction = require("../models/InventoryTransaction");

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
    const { items } = req.body;
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

    if (order.status === "CANCELLED") {
      return res.status(400).json({
        message: "Cancelled purchase orders cannot be received.",
      });
    }

    if (order.status === "RECEIVED") {
      return res.status(400).json({
        message: "Purchase order has already been fully received.",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "Received items are required.",
      });
    }

    for (const receivedItem of items) {
      const orderItem = order.items.id(receivedItem.itemId);

      if (!orderItem) {
        return res.status(400).json({
          message: "Purchase order item not found.",
        });
      }

      const receiveQuantity = Number(receivedItem.quantity);

      if (!receiveQuantity || receiveQuantity <= 0) {
        return res.status(400).json({
          message: "Received quantity must be greater than zero.",
        });
      }

      const remainingQuantity = orderItem.quantity - orderItem.receivedQuantity;

      if (receiveQuantity > remainingQuantity) {
        return res.status(400).json({
          message: `Cannot receive more than the remaining quantity for ${orderItem.product}.`,
        });
      }
    }

    // =========================
    // UPDATE INVENTORY
    // =========================

    for (const receivedItem of items) {
      const orderItem = order.items.id(receivedItem.itemId);

      const receiveQuantity = Number(receivedItem.quantity);

      let branchInventory = await BranchInventory.findOne({
        branch: order.branch,
        product: orderItem.product,
      });

      if (!branchInventory) {
        branchInventory = await BranchInventory.create({
          branch: order.branch,

          product: orderItem.product,

          quantity: 0,

          reorderLevel: 5,

          shelfLocation: "Not assigned",
        });
      }

      const previousQuantity = branchInventory.quantity;

      const newQuantity = previousQuantity + receiveQuantity;

      branchInventory.quantity = newQuantity;

      await branchInventory.save();

      orderItem.receivedQuantity += receiveQuantity;

      await InventoryTransaction.create({
        product: orderItem.product,

        branch: order.branch,

        type: "STOCK_IN",

        quantity: receiveQuantity,

        previousQuantity,

        newQuantity,

        reason: `Purchase Order ${order.poNumber}`,

        reference: order.poNumber,

        performedBy: req.user._id,

        notes: "Stock received from purchase order.",
      });
    }

    // =========================
    // DETERMINE STATUS
    // =========================

    const fullyReceived = order.items.every(
      (item) => item.receivedQuantity >= item.quantity,
    );

    const partiallyReceived = order.items.some(
      (item) => item.receivedQuantity > 0,
    );

    if (fullyReceived) {
      order.status = "RECEIVED";
    } else if (partiallyReceived) {
      order.status = "PARTIALLY_RECEIVED";
    }

    await order.save();

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
        path: "items.product",
        select: "name sku unit",
      },
    ]);

    res.json({
      message: "Purchase order received successfully.",

      purchaseOrder: populatedOrder,
    });
  } catch (error) {
    console.error("Receive purchase order error:", error);

    res.status(500).json({
      message: "Failed to receive purchase order.",
    });
  }
};

module.exports = {
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrderStatus,
  receivePurchaseOrder,
};
