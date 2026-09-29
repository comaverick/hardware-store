const multer = require("multer");
const {
  ALLOWED_IMAGE_TYPES,
  MAX_PRODUCT_IMAGE_BYTES,
} = require("../lib/productImages");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PRODUCT_IMAGE_BYTES,
    files: 1,
    fields: 20,
    parts: 21,
  },
  fileFilter: (_req, file, done) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return done(new Error("Choose a JPG, PNG, or WebP image."));
    }
    done(null, true);
  },
}).single("imageFile");

const parseProductImage = (req, res, next) => {
  upload(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Product images must be 5 MB or smaller." });
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ message: "Upload one product image at a time." });
    }
    return res.status(400).json({ message: error instanceof multer.MulterError
      ? "Invalid product upload. Check the form and try again."
      : error.message });
  });
};

module.exports = parseProductImage;
