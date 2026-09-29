const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const imageError = (message, status = 400) =>
  Object.assign(new Error(message), { status });

const isValidImage = (file) => {
  const bytes = file.buffer;
  if (file.mimetype === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (file.mimetype === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }
  if (file.mimetype === "image/webp") {
    return bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
};

const uploadProductImage = async (file) => {
  if (!ALLOWED_IMAGE_TYPES.has(file.mimetype) || !isValidImage(file)) {
    throw imageError("Choose a valid JPG, PNG, or WebP image.");
  }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw imageError("Product images must be 5 MB or smaller.");
  }
  if (!process.env.CLOUDINARY_URL) {
    throw imageError("Product image uploads are not configured on the server.", 503);
  }
  if (!process.env.CLOUDINARY_URL.startsWith("cloudinary://")) {
    throw imageError("The server's CLOUDINARY_URL must begin with cloudinary://.", 503);
  }

  try {
    const cloudinary = require("cloudinary").v2;
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          asset_folder: "hardware-store/products",
          public_id_prefix: "hardware-store/products",
          resource_type: "image",
        },
        (error, uploaded) => error ? reject(error) : resolve(uploaded),
      ).end(file.buffer);
    });
    if (!result?.secure_url || !result?.public_id) {
      throw new Error("Cloudinary returned an incomplete upload result");
    }
    return { image: result.secure_url, imagePublicId: result.public_id };
  } catch (error) {
    console.error("Product image upload failed (HTTP status):", error?.error?.http_code || error?.http_code || "unknown");
    throw imageError("Could not upload the product image. Please try again.", 502);
  }
};

const deleteProductImage = async (publicId) => {
  if (!publicId) return;
  try {
    const cloudinary = require("cloudinary").v2;
    await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  } catch (error) {
    console.error("Product image cleanup failed (HTTP status):", error?.error?.http_code || error?.http_code || "unknown");
  }
};

module.exports = {
  ALLOWED_IMAGE_TYPES,
  MAX_PRODUCT_IMAGE_BYTES,
  uploadProductImage,
  deleteProductImage,
};
