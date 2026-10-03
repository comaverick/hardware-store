const API_ORIGIN = (
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://hardware-store-nffe.onrender.com"
    : "http://localhost:5000")
)
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

export async function fetchStorefrontCatalog(branchId = "", signal) {
  const query = branchId ? `?branch=${encodeURIComponent(branchId)}` : "";
  const response = await fetch(`${API_ORIGIN}/api/storefront/catalog${query}`, { signal });
  if (!response.ok) {
    throw new Error("Store catalog could not load. Please try again.");
  }
  const catalog = await response.json();
  if (!Array.isArray(catalog.products) || !Array.isArray(catalog.branches)) {
    throw new Error("Store catalog could not load. Please try again.");
  }
  return catalog;
}

export async function fetchStorefrontProduct(productId, branchId = "", signal) {
  const query = branchId ? `?branch=${encodeURIComponent(branchId)}` : "";
  const response = await fetch(
    `${API_ORIGIN}/api/storefront/products/${encodeURIComponent(productId)}${query}`,
    { signal },
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Product not found.");
    }
    throw new Error("Product details could not load. Please try again.");
  }
  const data = await response.json();
  if (!data || !data.product) {
    throw new Error("Product details could not load. Please try again.");
  }
  return data;
}

export function productImageUrl(image) {
  if (!image) return "";
  try {
    const url = new URL(image, `${API_ORIGIN}/`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export const formatPrice = (price) =>
  `₱${Number(price || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
