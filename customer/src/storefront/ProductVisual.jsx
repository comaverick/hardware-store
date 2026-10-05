import { useEffect, useState } from "react";
import { Drop, Hammer, HardHat, Lightning, PaintBrush, SquaresFour, Wrench } from "@phosphor-icons/react";
import { productImageUrl } from "../storefrontCatalog";

export const categoryIcons = {
  Tools: Hammer, "Hand Tools": Hammer, "Power Tools": Wrench, Paint: PaintBrush,
  Electrical: Lightning, Plumbing: Drop, Hardware: Wrench, Fasteners: Wrench, Safety: HardHat,
};

export function ProductVisual({ product }) {
  const image = productImageUrl(product?.image);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  if (image && !failed) return <img src={image} alt={product?.name || "Product"} loading="lazy" onError={() => setFailed(true)} />;
  const Icon = categoryIcons[product?.category] || SquaresFour;
  return <Icon className="shop-product__placeholder" size={58} weight="duotone" aria-hidden="true" />;
}
