const express = require("express");
const Customer = require("../models/Customer");
const { createCustomerAuthMiddleware } = require("../middleware/customerAuthMiddleware");

function createCustomerAuthRouter({ CustomerModel = Customer, getAuth } = {}) {
  const router = express.Router();
  let indexesReady;
  function ensureIndexes() {
    if (!indexesReady) {
      indexesReady = Promise.resolve().then(() => CustomerModel.createIndexes()).catch((error) => {
        indexesReady = null;
        throw error;
      });
    }
    return indexesReady;
  }
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(createCustomerAuthMiddleware({ getAuth }));

  router.get("/me", async (req, res) => {
    try {
      const claims = req.customerClaims;
      const filter = { firebaseUid: claims.uid };
      const update = {
        $set: {
          name: typeof claims.name === "string" ? claims.name.trim().slice(0, 100) : "",
          email: claims.email.trim().toLowerCase(),
          emailVerified: claims.email_verified === true,
        },
      };
      // Ensure the unique UID index exists before concurrent first sign-ins.
      await ensureIndexes();
      let customer;
      try {
        customer = await CustomerModel.findOneAndUpdate(filter, update, {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
          runValidators: true,
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        customer = await CustomerModel.findOneAndUpdate(filter, update, {
          new: true,
          runValidators: true,
        });
      }
      if (!customer) throw new Error("Customer profile could not be loaded.");
      if (!customer.isActive) {
        return res.status(403).json({ message: "This customer account is disabled. Please contact the store." });
      }
      return res.json({
        customer: {
          id: String(customer._id),
          name: customer.name,
          email: customer.email,
          emailVerified: customer.emailVerified,
        },
      });
    } catch (error) {
      console.error("Customer profile unavailable:", error.code || error.name);
      return res.status(503).json({ message: "Your account could not load. Please try again shortly." });
    }
  });

  return router;
}

module.exports = { router: createCustomerAuthRouter(), createCustomerAuthRouter };
