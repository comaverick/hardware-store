import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardText,
  Drop,
  Hammer,
  HardHat,
  House,
  Lightning,
  MagnifyingGlass,
  MapPin,
  Minus,
  PaintBrush,
  Plus,
  ShieldCheck,
  ShoppingCart,
  SquaresFour,
  Storefront,
  Wrench,
} from "@phosphor-icons/react";
import { useReservationCart } from "../cart/reservationCart";
import {
  fetchStorefrontProduct,
  fetchStorefrontCatalog,
  formatPrice,
  productImageUrl,
} from "../storefrontCatalog";
import "./ProductDetails.css";

const categoryIcons = {
  Tools: Hammer,
  "Hand Tools": Hammer,
  "Power Tools": Wrench,
  Paint: PaintBrush,
  Electrical: Lightning,
  Plumbing: Drop,
  Hardware: Wrench,
  Fasteners: Wrench,
  Safety: HardHat,
};

function ProductVisual({ product, size = 72 }) {
  const image = productImageUrl(product?.image);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [image]);

  if (image && !failed) {
    return (
      <img
        src={image}
        alt={product?.name || "Product"}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  const Icon = categoryIcons[product?.category] || SquaresFour;
  return (
    <Icon
      className="pdp-visual__placeholder"
      size={size}
      weight="duotone"
      aria-hidden="true"
    />
  );
}

export default function ProductDetails({
  cachedProducts = [],
  cachedBranches = [],
  initialBranchId = "",
  onBranchChange,
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addItem, show } = useReservationCart();

  // Find initial product from cache if available for instant display
  const initialProduct = cachedProducts.find((p) => p._id === id) || null;

  const [product, setProduct] = useState(initialProduct);
  const [branches, setBranches] = useState(cachedBranches);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [loading, setLoading] = useState(!initialProduct);
  const [error, setError] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [addedFeedback, setAddedFeedback] = useState(false);
  const [relatedProducts, setRelatedProducts] = useState([]);

  // Sync branches from props if updated
  useEffect(() => {
    if (cachedBranches.length && !branches.length) {
      setBranches(cachedBranches);
    }
  }, [cachedBranches, branches.length]);

  // Sync branchId from props
  useEffect(() => {
    if (initialBranchId && !branchId) {
      setBranchId(initialBranchId);
    }
  }, [initialBranchId, branchId]);

  // Fetch product details
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    // If we don't have initial cached product, set loading
    if (!initialProduct || initialProduct._id !== id) {
      setLoading(true);
    }
    setError("");
    setQuantity(1);
    setAddedFeedback(false);

    // Scroll to top on id change
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        // Fallback for older browsers
        try {
          window.scrollTo(0, 0);
        } catch {}
      }
    }

    fetchStorefrontProduct(id, branchId, controller.signal)
      .then((data) => {
        if (!active) return;
        setProduct(data.product);
        if (Array.isArray(data.branches) && data.branches.length) {
          setBranches(data.branches);
        }
      })
      .catch((err) => {
        if (!active) return;
        // Fallback to cached catalog product if API fails or in offline/mock mode
        const fallback = cachedProducts.find((p) => p._id === id);
        if (fallback) {
          setProduct(fallback);
        } else {
          setError(err.message || "Failed to load product details.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [id, branchId, initialProduct, cachedProducts]);

  // Compute / fetch related products
  useEffect(() => {
    if (cachedProducts.length && product) {
      const related = cachedProducts
        .filter((p) => p._id !== product._id && p.category === product.category)
        .slice(0, 4);
      setRelatedProducts(
        related.length
          ? related
          : cachedProducts.filter((p) => p._id !== product._id).slice(0, 4),
      );
    } else if (!cachedProducts.length && product) {
      fetchStorefrontCatalog(branchId)
        .then((catalog) => {
          if (Array.isArray(catalog.products)) {
            const related = catalog.products
              .filter((p) => p._id !== product._id && p.category === product.category)
              .slice(0, 4);
            setRelatedProducts(
              related.length
                ? related
                : catalog.products.filter((p) => p._id !== product._id).slice(0, 4),
            );
            if (!branches.length && Array.isArray(catalog.branches)) {
              setBranches(catalog.branches);
            }
          }
        })
        .catch(() => {});
    }
  }, [product, cachedProducts, branchId, branches.length]);

  function handleBranchSelect(e) {
    const newBranchId = e.target.value;
    setBranchId(newBranchId);
    if (onBranchChange) {
      onBranchChange(newBranchId);
    }
  }

  function handleQuantityChange(delta) {
    setQuantity((prev) => {
      const next = prev + delta;
      if (next < 1) return 1;
      if (
        branchId &&
        product?.availableQuantity !== null &&
        product?.availableQuantity !== undefined &&
        product.availableQuantity > 0
      ) {
        return Math.min(next, product.availableQuantity);
      }
      return Math.min(next, 99);
    });
  }

  function handleQuantityInput(e) {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 1) {
      setQuantity(1);
    } else if (
      branchId &&
      product?.availableQuantity !== null &&
      product?.availableQuantity !== undefined &&
      product.availableQuantity > 0
    ) {
      setQuantity(Math.min(val, product.availableQuantity));
    } else {
      setQuantity(Math.min(val, 99));
    }
  }

  function handleAddToCart() {
    if (!product) return;
    addItem(
      {
        id: product._id,
        name: product.name,
        price: product.sellingPrice,
        image: productImageUrl(product.image),
      },
      quantity,
    );
    setAddedFeedback(true);
    setTimeout(() => setAddedFeedback(false), 2500);
  }

  const selectedBranch = branches.find((b) => b._id === branchId);
  const isOutOfStock = Boolean(branchId && product?.availableQuantity === 0);

  if (loading && !product) {
    return (
      <div className="shop-container pdp-state" role="status">
        <div className="pdp-spinner" aria-hidden="true" />
        <h2>Loading product details…</h2>
        <p>Fetching the latest pricing and inventory information.</p>
      </div>
    );
  }

  if (error && !product) {
    return (
      <div className="shop-container pdp-state pdp-state--error" role="alert">
        <MagnifyingGlass size={36} aria-hidden="true" />
        <h2>Product not found</h2>
        <p>{error}</p>
        <Link to="/" className="shop-button shop-button--primary">
          <ArrowLeft size={18} weight="bold" /> Back to store catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="pdp-page">
      {/* Breadcrumbs & Navigation */}
      <nav className="shop-container pdp-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/" className="pdp-breadcrumb-link">
          <House size={16} aria-hidden="true" />
          <span>Home</span>
        </Link>
        <span className="pdp-breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <Link
          to={`/?category=${encodeURIComponent(product.category || "All")}`}
          className="pdp-breadcrumb-link"
        >
          {product.category || "Catalog"}
        </Link>
        <span className="pdp-breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <span className="pdp-breadcrumb-current" aria-current="page">
          {product.name}
        </span>
      </nav>

      {/* Main Product Showcase */}
      <main className="shop-container pdp-main">
        <div className="pdp-grid">
          {/* Left Column: Visual Showcase */}
          <div className="pdp-gallery">
            <div className="pdp-gallery__stage">
              <ProductVisual product={product} size={110} />
              {product.category && (
                <span className="pdp-gallery__badge">{product.category}</span>
              )}
            </div>
            <div className="pdp-back-action">
              <button
                type="button"
                className="pdp-back-button"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft size={16} weight="bold" /> Back to products
              </button>
            </div>
          </div>

          {/* Right Column: Product Overview & Buy Box */}
          <div className="pdp-info">
            <div className="pdp-header">
              <div className="pdp-meta-row">
                {product.brand && (
                  <span className="pdp-brand-tag">{product.brand}</span>
                )}
                <span className="pdp-sku">SKU: {product.sku}</span>
              </div>
              <h1 className="pdp-title">{product.name}</h1>
            </div>

            {/* Price Box */}
            <div className="pdp-price-box">
              <div className="pdp-price-row">
                <span className="pdp-price">
                  {formatPrice(product.sellingPrice)}
                </span>
                <span className="pdp-unit">/ {product.unit}</span>
              </div>
              <p className="pdp-price-note">
                Taxes included. Reserve online, inspect and pay upon branch pickup.
              </p>
            </div>

            {/* Branch Stock Checker */}
            <div className="pdp-stock-box">
              <label htmlFor="pdp-branch-select" className="pdp-stock-label">
                <MapPin size={18} weight="bold" aria-hidden="true" />
                <span>Branch Stock & Pickup</span>
              </label>
              <select
                id="pdp-branch-select"
                className="pdp-branch-select"
                value={branchId}
                onChange={handleBranchSelect}
              >
                <option value="">Select a branch to check stock</option>
                {branches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>

              <div
                className={`pdp-stock-status${
                  !branchId
                    ? " pdp-stock-status--neutral"
                    : isOutOfStock
                      ? " pdp-stock-status--empty"
                      : " pdp-stock-status--available"
                }`}
              >
                <span className="pdp-stock-dot" aria-hidden="true" />
                <div>
                  <strong>
                    {!branchId
                      ? "Choose a branch to see pickup availability"
                      : isOutOfStock
                        ? `Out of stock at ${selectedBranch?.name || "this branch"}`
                        : `In stock — ${product.availableQuantity} available at ${
                            selectedBranch?.name || "this branch"
                          }`}
                  </strong>
                  <small>
                    {!branchId
                      ? "Stock counts update dynamically when you choose a pickup branch."
                      : isOutOfStock
                        ? "Check back soon or choose a different branch location."
                        : "Ready for pickup once your draft reservation is confirmed."}
                  </small>
                </div>
              </div>
            </div>

            {/* Add to Cart Actions */}
            <div className="pdp-actions">
              <div className="pdp-quantity-wrap">
                <label htmlFor="pdp-quantity-input" className="sr-only">
                  Quantity
                </label>
                <div className="pdp-quantity-control">
                  <button
                    type="button"
                    onClick={() => handleQuantityChange(-1)}
                    disabled={quantity <= 1 || isOutOfStock}
                    aria-label="Decrease quantity"
                  >
                    <Minus size={16} weight="bold" />
                  </button>
                  <input
                    id="pdp-quantity-input"
                    type="number"
                    min="1"
                    max={
                      branchId && product.availableQuantity > 0
                        ? product.availableQuantity
                        : 99
                    }
                    value={quantity}
                    onChange={handleQuantityInput}
                    disabled={isOutOfStock}
                    aria-label={`Quantity for ${product.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => handleQuantityChange(1)}
                    disabled={
                      isOutOfStock ||
                      (branchId &&
                        product.availableQuantity > 0 &&
                        quantity >= product.availableQuantity)
                    }
                    aria-label="Increase quantity"
                  >
                    <Plus size={16} weight="bold" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                className={`pdp-add-btn${addedFeedback ? " pdp-add-btn--added" : ""}`}
                disabled={isOutOfStock}
                onClick={handleAddToCart}
              >
                {addedFeedback ? (
                  <>
                    <Check size={20} weight="bold" />
                    <span>Added to Cart!</span>
                  </>
                ) : isOutOfStock ? (
                  <span>Out of stock at this branch</span>
                ) : (
                  <>
                    <ShoppingCart size={20} weight="bold" />
                    <span>
                      Add {quantity > 1 ? `${quantity} ` : ""}to Cart
                    </span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="pdp-view-cart-btn"
                onClick={show}
              >
                View cart
              </button>
            </div>

            {/* ScanSpace Teaser if available */}
            {product.scanSpace && (
              <div className="pdp-scanspace-card">
                <SquaresFour size={24} weight="duotone" aria-hidden="true" />
                <div>
                  <strong>Room Planning Available</strong>
                  <span>
                    Preview this item with 3D sizing in ScanSpace room planner.
                  </span>
                </div>
                <Link to="/scanspace" className="pdp-scanspace-link">
                  ScanSpace <ArrowRight size={15} weight="bold" />
                </Link>
              </div>
            )}

            {/* Trust Assurances */}
            <div className="pdp-benefits">
              <div className="pdp-benefit">
                <Storefront size={22} weight="duotone" />
                <div>
                  <strong>Branch Pickup</strong>
                  <small>Collect and inspect directly at your store.</small>
                </div>
              </div>
              <div className="pdp-benefit">
                <ClipboardText size={22} weight="duotone" />
                <div>
                  <strong>Draft Reservation</strong>
                  <small>Hold items online without upfront deposit.</small>
                </div>
              </div>
              <div className="pdp-benefit">
                <ShieldCheck size={22} weight="duotone" />
                <div>
                  <strong>Trade-Tested Quality</strong>
                  <small>Authentic hardware backed by store warranty.</small>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Product Details & Specifications Tab/Sections */}
        <section className="pdp-details-section">
          <div className="pdp-section-header">
            <h2>Product Details</h2>
          </div>
          <div className="pdp-details-grid">
            <div className="pdp-description-box">
              <h3>Description</h3>
              <p>
                {product.description ||
                  "Quality hardware equipment and materials engineered for dependable trade and home improvement projects. Built to meet professional hardware standards."}
              </p>
            </div>
            <div className="pdp-specs-box">
              <h3>Specifications</h3>
              <dl className="pdp-specs-list">
                <div className="pdp-spec-row">
                  <dt>Product Name</dt>
                  <dd>{product.name}</dd>
                </div>
                <div className="pdp-spec-row">
                  <dt>SKU</dt>
                  <dd>{product.sku}</dd>
                </div>
                {product.brand && (
                  <div className="pdp-spec-row">
                    <dt>Brand</dt>
                    <dd>{product.brand}</dd>
                  </div>
                )}
                <div className="pdp-spec-row">
                  <dt>Category</dt>
                  <dd>{product.category || "General"}</dd>
                </div>
                <div className="pdp-spec-row">
                  <dt>Unit of Measure</dt>
                  <dd>{product.unit || "piece"}</dd>
                </div>
                <div className="pdp-spec-row">
                  <dt>Price</dt>
                  <dd>
                    {formatPrice(product.sellingPrice)} per {product.unit}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <section className="pdp-related-section">
            <div className="pdp-section-header">
              <h2>You may also need</h2>
              <p>Commonly paired supplies from the {product.category} collection.</p>
            </div>
            <div className="shop-products__grid pdp-related-grid">
              {relatedProducts.map((item) => (
                <article className="shop-product pdp-related-card" key={item._id}>
                  <Link
                    to={`/products/${item._id}`}
                    className="shop-product__card-link"
                    aria-label={`View details for ${item.name}`}
                  >
                    <div className="shop-product__image">
                      <ProductVisual product={item} size={58} />
                    </div>
                    <div className="shop-product__details">
                      <span className="shop-product__category">
                        {item.brand ? `${item.brand} · ` : ""}
                        {item.sku}
                      </span>
                      <h3>{item.name}</h3>
                      <strong className="shop-product__price">
                        {formatPrice(item.sellingPrice)}{" "}
                        <small>/ {item.unit}</small>
                      </strong>
                    </div>
                  </Link>
                  <div className="shop-product__actions">
                    <button
                      className="shop-product__button"
                      type="button"
                      onClick={() =>
                        addItem({
                          id: item._id,
                          name: item.name,
                          price: item.sellingPrice,
                          image: productImageUrl(item.image),
                        })
                      }
                    >
                      Add to cart
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
