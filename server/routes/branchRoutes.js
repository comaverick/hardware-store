const express = require("express");

const {
  getBranches,
  getBranch,
  createBranch,
} = require("../controllers/branchController");

const router = express.Router();

router.get("/", getBranches);

router.get("/:id", getBranch);

router.post("/", createBranch);

module.exports = router;