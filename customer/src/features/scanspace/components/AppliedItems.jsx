import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ShoppingCart } from "@phosphor-icons/react/dist/csr/ShoppingCart";
import { useReservationCart } from "../../../cart/reservationCart";
import { fetchStorefrontCatalog, formatPrice, productImageUrl } from "../../../storefrontCatalog";
import { ProductVisual } from "../../../storefront/ProductVisual";
import { floorFinishes, paintColors, sanitizeScanCustomization } from "../core/scanCustomization";

function appliedFinishes(customization) {
  const applied = sanitizeScanCustomization(customization);
  const items = new Map();
  for (const [surface, label] of [["walls", "Walls"], ["floor", "Floor"], ["ceiling", "Ceiling"]]) {
    const selection = applied?.[surface];
    if (!selection) continue;
    const key = surface === "floor" ? `floor:${selection.finishId}` : `paint:${selection.color}:${selection.finish}`;
    if (items.has(key)) {
      items.get(key).surfaces.push(label);
      continue;
    }
    const floor = surface === "floor" ? floorFinishes.find(finish => finish.id === selection.finishId) : null;
    const color = paintColors.find(choice => choice.color === selection.color);
    items.set(key, { key, surface, selection, surfaces: [label],
      name: floor ? `${floor.name} flooring` : `${color?.name || "Saved color"} paint · ${selection.finish}`,
      color: floor?.color || selection.color,
    });
  }
  return [...items.values()];
}

function matchesFinish(product, item) {
  const finish = product.scanSpace;
  if (!/^[a-f0-9]{24}$/i.test(product._id) || !finish?.enabled ||
    !Number.isFinite(product.sellingPrice) || product.sellingPrice < 0) return false;
  return item.surface === "floor"
    ? ["wood", "tile", "vinyl"].includes(finish.materialType) && finish.floorFinishId === item.selection.finishId
    : finish.materialType === "paint" && finish.color?.toLowerCase() === item.selection.color &&
      finish.paintFinish === item.selection.finish;
}

function remainingQuantity(product, draft, branchId) {
  if (!product) return 0;
  const inCart = Number(draft?.items?.find(item => item.productId === product._id)?.quantity) || 0;
  const stock = branchId ? Math.max(0, Math.floor(Number(product.availableQuantity) || 0)) : 9999;
  return Math.max(0, Math.min(9999, stock) - inCart);
}

function validQuantity(item, draft, branchId) {
  return !!item.product && Number.isSafeInteger(item.amount) && item.amount > 0 &&
    item.amount <= remainingQuantity(item.product, draft, branchId);
}

function packageLabel(product) {
  const finish = product.scanSpace;
  return finish.materialType === "paint" && finish.packageVolume ? `${finish.packageVolume} L can`
    : finish.coveragePerPack ? `${finish.coveragePerPack} m² / box` : product.unit || "";
}

export default function AppliedItems({ customization }) {
  const sectionId = useId();
  const applied = useMemo(() => appliedFinishes(customization), [customization]);
  const hasApplied = applied.length > 0;
  const branchId = useReservationCart(state => state.branchId);
  const draft = useReservationCart(state => state.draft);
  const [catalog, setCatalog] = useState({ products: [], branchId: null, loading: false, error: "" });
  const [choices, setChoices] = useState({});
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setChoices(previous => Object.fromEntries(applied.filter(item => previous[item.key])
      .map(item => [item.key, previous[item.key]])));
    setNotice("");
  }, [applied]);

  useEffect(() => {
    if (!hasApplied) {
      setCatalog({ products: [], branchId: null, loading: false, error: "" });
      return undefined;
    }
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
  }, [hasApplied, branchId, retry]);

  const checked = !catalog.loading && !catalog.error && catalog.branchId === branchId;
  const error = catalog.branchId === branchId ? catalog.error : "";
  const items = applied.map(item => {
    const product = checked ? catalog.products.find(candidate => matchesFinish(candidate, item)) : null;
    const choice = choices[item.key] || { selected: true, quantity: "1" };
    return { ...item, product, ...choice, amount: Number(choice.quantity) };
  });
  const selected = items.filter(item => item.product && item.selected);
  const total = selected.reduce((sum, item) => sum + (Number.isSafeInteger(item.amount) && item.amount > 0
    ? item.amount * item.product.sellingPrice : 0), 0);
  const canAddSelected = checked && selected.length > 0 && selected.every(item => validQuantity(item, draft, branchId));
  const canAddAll = checked && items.length > 0 && items.every(item => validQuantity(item, draft, branchId));

  function updateChoice(item, changes) {
    setChoices(previous => ({ ...previous,
      [item.key]: { selected: item.selected, quantity: item.quantity, ...changes },
    }));
    setNotice("");
  }

  function addItems(toAdd) {
    const cart = useReservationCart.getState();
    if (!checked || catalog.branchId !== cart.branchId || !toAdd.length ||
      !toAdd.every(item => validQuantity(item, cart.draft, cart.branchId))) return;
    cart.addItems(toAdd.map(item => ({ product: {
      id: item.product._id, name: item.product.name, price: item.product.sellingPrice,
      image: productImageUrl(item.product.image),
    }, quantity: item.amount })));
    setNotice(`${toAdd.length} ${toAdd.length === 1 ? "item" : "items"} added to your cart.`);
  }

  return <section className="ss-applied-items" aria-labelledby={`${sectionId}-heading`}>
    <div className="ss-applied-heading">
      <div>
        <h2 id={`${sectionId}-heading`}>Applied items</h2>
        <p>{hasApplied ? "Choose what to buy from your room design." : "Apply paint or flooring to your room to build your list."}</p>
      </div>
      {hasApplied && <span className="ss-applied-count">{items.length} {items.length === 1 ? "item" : "items"}</span>}
    </div>
    {hasApplied && <>
      {!checked && <div className="ss-applied-loading">
        <p role="status">{error || "Loading store products…"}</p>
        {error && <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button>}
      </div>}
      {checked && <ul className="ss-applied-list" aria-label="Applied finishes">
        {items.map((item, index) => {
          const { product } = item;
          const name = product?.name || item.name;
          const remaining = remainingQuantity(product, draft, branchId);
          const statusId = `${sectionId}-stock-${index}`;
          const status = !product ? "This finish is not available in the store."
            : branchId && !remaining ? (product.availableQuantity > 0
              ? "All available units are already in your cart." : "Out of stock at your pickup branch.")
              : !validQuantity(item, draft, branchId) ? `Choose a whole quantity from 1 to ${remaining}.`
                : branchId ? `${product.availableQuantity} available at your pickup branch.` : "";
          return <li className="ss-applied-item" key={item.key}>
            <label className="ss-applied-select">
              <input type="checkbox" aria-label={`Select ${name}`} checked={!!product && item.selected}
                disabled={!product} onChange={event => updateChoice(item, { selected: event.target.checked })} />
            </label>
            <div className="ss-applied-image">
              <ProductVisual product={product || { name, scanSpace: { enabled: true, color: item.color,
                materialType: item.surface === "floor" ? "wood" : "paint" } }} size={32} />
            </div>
            <div className="ss-applied-details">
              {product ? <Link to={`/products/${product._id}`}>{name}</Link> : <strong>{name}</strong>}
              <p>{item.surfaces.join(" · ")}{product && ` · ${packageLabel(product)}`}</p>
              {product && <span>{formatPrice(product.sellingPrice)} each</span>}
              {status && <p id={statusId} className="ss-applied-status" role="status">{status}</p>}
            </div>
            {product && <label className="ss-applied-quantity">Quantity
              <input type="number" aria-label={`Quantity for ${name}`} aria-describedby={status ? statusId : undefined}
                min="1" max={remaining || 1} step="1" value={item.quantity} disabled={remaining === 0}
                onChange={event => updateChoice(item, { quantity: event.target.value })} />
            </label>}
          </li>;
        })}
      </ul>}
      <div className="ss-applied-footer">
        <div className="ss-applied-total">
          <span>{selected.length} selected</span>
          <strong>{formatPrice(total)}</strong>
        </div>
        <div className="ss-applied-actions">
          <button type="button" disabled={!canAddAll} onClick={() => addItems(items)}>Add all</button>
          <button type="button" className="ss-primary" disabled={!canAddSelected} onClick={() => addItems(selected)}>
            <ShoppingCart size={18} aria-hidden="true" />Add selected
          </button>
        </div>
        {(notice || !branchId) && <p role="status">{notice || "Choose a pickup branch in your cart."}</p>}
      </div>
    </>}
  </section>;
}
