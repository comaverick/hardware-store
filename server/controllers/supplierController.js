const Supplier = require("../models/Supplier");

// =========================
// GET ALL SUPPLIERS
// =========================

const getSuppliers = async (req, res) => {
  try {
    const suppliers = await Supplier.find().sort({
      createdAt: -1,
    });

    res.json(suppliers);
  } catch (error) {
    console.error("Get suppliers error:", error);

    res.status(500).json({
      message: "Failed to retrieve suppliers.",
    });
  }
};

// =========================
// GET ONE SUPPLIER
// =========================

const getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);

    if (!supplier) {
      return res.status(404).json({
        message: "Supplier not found.",
      });
    }

    res.json(supplier);
  } catch (error) {
    console.error("Get supplier error:", error);

    res.status(500).json({
      message: "Failed to retrieve supplier.",
    });
  }
};

// =========================
// CREATE SUPPLIER
// =========================

const createSupplier = async (req, res) => {
  try {
    const {
      name,
      code,
      contactPerson,
      email,
      phone,
      address,
      paymentTerms,
      notes,
    } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        message: "Supplier name and code are required.",
      });
    }

    const existingSupplier = await Supplier.findOne({
      code: code.toUpperCase(),
    });

    if (existingSupplier) {
      return res.status(400).json({
        message: "Supplier code already exists.",
      });
    }

    const supplier = await Supplier.create({
      name,
      code,
      contactPerson,
      email,
      phone,
      address,
      paymentTerms,
      notes,
    });

    res.status(201).json(supplier);
  } catch (error) {
    console.error("Create supplier error:", error);

    res.status(500).json({
      message: "Failed to create supplier.",
    });
  }
};

// =========================
// UPDATE SUPPLIER
// =========================

const updateSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);

    if (!supplier) {
      return res.status(404).json({
        message: "Supplier not found.",
      });
    }

    const {
      name,
      code,
      contactPerson,
      email,
      phone,
      address,
      paymentTerms,
      notes,
      isActive,
    } = req.body;

    if (code) {
      const existingSupplier = await Supplier.findOne({
        code: code.toUpperCase(),

        _id: {
          $ne: supplier._id,
        },
      });

      if (existingSupplier) {
        return res.status(400).json({
          message: "Supplier code already exists.",
        });
      }

      supplier.code = code.toUpperCase();
    }

    if (name !== undefined) supplier.name = name;

    if (contactPerson !== undefined) supplier.contactPerson = contactPerson;

    if (email !== undefined) supplier.email = email;

    if (phone !== undefined) supplier.phone = phone;

    if (address !== undefined) supplier.address = address;

    if (paymentTerms !== undefined) supplier.paymentTerms = paymentTerms;

    if (notes !== undefined) supplier.notes = notes;

    if (isActive !== undefined) supplier.isActive = isActive;

    await supplier.save();

    res.json(supplier);
  } catch (error) {
    console.error("Update supplier error:", error);

    res.status(500).json({
      message: "Failed to update supplier.",
    });
  }
};

// =========================
// DEACTIVATE SUPPLIER
// =========================

const deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);

    if (!supplier) {
      return res.status(404).json({
        message: "Supplier not found.",
      });
    }

    // Soft delete
    supplier.isActive = false;

    await supplier.save();

    res.json({
      message: "Supplier deactivated successfully.",
      supplier,
    });
  } catch (error) {
    console.error("Delete supplier error:", error);

    res.status(500).json({
      message: "Failed to deactivate supplier.",
    });
  }
};

module.exports = {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
};
