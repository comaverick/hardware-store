import { useEffect, useState } from "react";
import { Drop, Hammer, HardHat, Lightning, PaintBrush, SquaresFour, Wrench } from "@phosphor-icons/react";
import { productImageUrl } from "../storefrontCatalog";

export const categoryIcons = {
  Tools: Hammer, "Hand Tools": Hammer, "Power Tools": Wrench, Paint: PaintBrush,
  Electrical: Lightning, Plumbing: Drop, Hardware: Wrench, Fasteners: Wrench, Safety: HardHat,
};

export function ProductVisual({ product, size = 58, placeholderClassName = "shop-product__placeholder" }) {
  const image = productImageUrl(product?.image);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  if (image && !failed) return <img src={image} alt={product?.name || "Product"} loading="lazy" onError={() => setFailed(true)} />;
  const finish = product?.scanSpace;
  if (finish?.enabled && /^#[0-9a-f]{6}$/i.test(finish.color) &&
    ["paint", "wood", "tile", "vinyl"].includes(finish.materialType)) {
    return <div className={`shop-product__finish shop-product__finish--${finish.materialType}`}
      style={{ "--product-finish": finish.color }} aria-hidden="true">
      {finish.materialType === "paint" && <PaintBrush size={Math.min(size, 42)} weight="duotone" />}
    </div>;
  }
  const Icon = categoryIcons[product?.category] || SquaresFour;
  return <Icon className={placeholderClassName} size={size} weight="duotone" aria-hidden="true" />;
}
