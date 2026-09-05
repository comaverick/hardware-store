const fs = require("node:fs");
const path = require("node:path");
const source = path.resolve(__dirname, "../../server/lib/scanspaceDomain.js");
const target = path.resolve(
  __dirname,
  "../src/features/scanspace/core/domain.js",
);
if (fs.existsSync(source)) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
} else if (!fs.existsSync(target)) {
  throw new Error(
    "ScanSpace domain module is missing. Build from the repository root first.",
  );
}
