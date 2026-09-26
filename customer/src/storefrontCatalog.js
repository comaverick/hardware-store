import drillImage from "./assets/product-drill.webp";
import hammerImage from "./assets/product-hammer.webp";
import paintImage from "./assets/product-paint.webp";
import fastenersImage from "./assets/product-fasteners.webp";

export const categories = [
  "Tools",
  "Paint",
  "Electrical",
  "Plumbing",
  "Hardware",
  "Safety",
];

// This local catalog powers the storefront preview until inventory is connected.
export const products = [
  {
    id: "drill-18v",
    name: "18V Cordless Drill Set",
    category: "Tools",
    detail: "Power tools",
    price: 3490,
    stock: "Available today",
    image: drillImage,
  },
  {
    id: "steel-claw-hammer",
    name: "Steel Claw Hammer",
    category: "Tools",
    detail: "Hand tools",
    price: 445,
    stock: "Available today",
    image: hammerImage,
  },
  {
    id: "interior-paint-set",
    name: "Interior Paint Starter Set",
    category: "Paint",
    detail: "Paint supplies",
    price: 1280,
    stock: "Limited stock",
    image: paintImage,
  },
  {
    id: "screw-anchor-kit",
    name: "Screw and Anchor Kit",
    category: "Hardware",
    detail: "Fasteners",
    price: 690,
    stock: "Available today",
    image: fastenersImage,
  },
];

export const formatPrice = (price) =>
  `₱${Number(price || 0).toLocaleString("en-PH")}`;
