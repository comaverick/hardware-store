import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { ShoppingCart } from "@phosphor-icons/react/dist/csr/ShoppingCart";
import { useReservationCart } from "../../../cart/reservationCart";
import { fetchStorefrontCatalog, formatPrice, productImageUrl } from "../../../storefrontCatalog";

function matchesFinish(product, surface, selection) {
  const finish = product.scanSpace;
  if (!/^[a-f0-9]{24}$/i.test(product._id) || !finish?.enabled ||
    !Number.isFinite(product.sellingPrice) || product.sellingPrice < 0) return false;
  return surface === "floor"
    ? ["wood", "tile", "vinyl"].includes(finish.materialType) && finish.floorFinishId === selection.finishId
    : finish.materialType === "paint" && finish.color?.toLowerCase() === selection.color?.toLowerCase() &&
      finish.paintFinish === selection.finish;
}

export default function FinishProductCart({ surface, selection }) {
  const quantityId = useId();
  const branchId = useReservationCart(state => state.branchId);
  const draft = useReservationCart(state => state.draft);
  const [catalog, setCatalog] = useState({ products: [], branchId: null, loading: true, error: "" });
  const [retry, setRetry] = useState(0);
  const [quantity, setQuantity] = useState("1");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    setCatalog({ products: [], branchId, loading: true, error: "" });
    fetchStorefrontCatalog(branchId, controller.signal).then(data => {
      if (active) setCatalog({ products: data.products, branchId, loading: false, error: "" });
    }).catch(() => {
      if (active) setCatalog({ products: [], branchId, loading: false, error: "Store products could not load." });
    }).finally(() => window.clearTimeout(timer));
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [branchId, retry]);

  const checked = !catalog.loading && !catalog.error && catalog.branchId === branchId;
  const product = checked ? catalog.products.find(item => matchesFinish(item, surface, selection)) : null;
  useEffect(() => setQuantity("1"), [product?._id]);
  const alreadyInCart = draft?.items?.find(item => item.productId === product?._id)?.quantity || 0;
  const stock = branchId && product ? product.availableQuantity ?? 0 : null;
  const remaining = stock === null ? 9999 - alreadyInCart : Math.max(0, Math.min(9999 - alreadyInCart, stock - alreadyInCart));
  const amount = Number(quantity);
  const canAdd = !!product && Number.isSafeInteger(amount) && amount > 0 && amount <= remaining;
  const packageLabel = product?.scanSpace.materialType === "paint" && product.scanSpace.packageVolume
    ? `${product.scanSpace.packageVolume} L can`
    : product?.scanSpace.coveragePerPack ? `${product.scanSpace.coveragePerPack} m² / box` : product?.unit || "";

  return <div className="ss-finish-shopping">
    {product ? <>
      <div className="ss-finish-shopping-details">
        <Link to={`/products/${product._id}`}>{packageLabel} · Product details</Link>
        <strong>{formatPrice(product.sellingPrice)}</strong>
      </div>
      <label className="ss-finish-quantity" htmlFor={quantityId}>Quantity
        <input id={quantityId} type="number" min="1" max={remaining || 1} step="1" value={quantity}
          onChange={event => setQuantity(event.target.value)} />
      </label>
    </> : <p role="status">{catalog.error || (catalog.loading || catalog.branchId !== branchId
      ? "Loading store products…" : "Choose a store finish to add it to your cart.")}</p>}
    <button type="button" className="ss-primary" disabled={!canAdd} onClick={() => {
      if (!canAdd) return;
      useReservationCart.getState().addItem({ id: product._id, name: product.name,
        price: product.sellingPrice, image: productImageUrl(product.image) }, amount);
    }}>
      <ShoppingCart size={18} aria-hidden="true" />
      {product && stock === 0 ? "Out of stock" : "Add to cart"}
    </button>
    {catalog.error && <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button>}
    {product && <p role="status">{stock === null ? "Choose a pickup branch in your cart."
      : remaining === 0 && stock > 0 ? "All available units are already in your cart."
        : `${stock} available at your pickup branch.`}
      {quantity !== "" && (!Number.isSafeInteger(amount) || amount < 1 || amount > remaining) && remaining > 0
        ? ` Choose a whole quantity from 1 to ${remaining}.` : ""}</p>}
  </div>;
}
