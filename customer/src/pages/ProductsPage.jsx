import { Link } from "react-router-dom";
import { MagnifyingGlass, MapPin } from "@phosphor-icons/react";
import { ProductVisual } from "../storefront/ProductVisual";
import { formatPrice } from "../storefrontCatalog";

export default function ProductsPage({ activeCategory, resetFilters, chooseCategory, categories, branchId,
  setBranchId, branches, selectedBranch, visibleProducts, loading, error, onRetry, query, handleAddToCart, products }) {
  return <main className="shop-container shop-catalog" id="products">
    <div className="shop-catalog__heading"><h1>Products</h1><p>The right supplies, all in one place.</p></div>
    <div className="shop-catalog__toolbar">
      <nav className="shop-category-filter" aria-label="Product categories">
        {["All", ...categories].map((category) => <button type="button" key={category}
          aria-pressed={activeCategory === category} onClick={() => chooseCategory(category)}>{category === "All" ? "All products" : category}</button>)}
      </nav>
      <div className="shop-branch-control">
        <label htmlFor="shop-branch"><MapPin size={17} aria-hidden="true" /> Check stock at</label>
        <select id="shop-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={!branches.length}>
          <option value="">Choose a branch</option>{branches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name}</option>)}
        </select>
      </div>
    </div>
    <div className="shop-catalog__results">
      <p role="status">{loading ? "Loading products…" : error ? "Catalog unavailable" : `${visibleProducts.length} ${visibleProducts.length === 1 ? "product" : "products"}${query ? ` for “${query}”` : activeCategory !== "All" ? ` in ${activeCategory}` : ""}`}</p>
      {(query || activeCategory !== "All") && <button className="shop-text-button" type="button" onClick={resetFilters}>Clear filters</button>}
    </div>
    {loading ? (
      <div className="shop-products__grid shop-products__skeleton" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <div key={index}><span /><i /><i /></div>)}</div>
    ) : error ? (
      <div className="shop-products__empty" role="alert"><h2>Products are unavailable</h2><p>{error}</p><button className="shop-button shop-button--outline" type="button" onClick={onRetry}>Try again</button></div>
    ) : visibleProducts.length ? (
      <div className="shop-products__grid">{visibleProducts.map((product) => <article className="shop-product" key={product._id}>
        <Link to={`/products/${product._id}`} className="shop-product__card-link" aria-label={`View details for ${product.name}`}>
          <div className="shop-product__image"><ProductVisual product={product} /></div>
          <div className="shop-product__details">
            <span className="shop-product__category">{product.brand ? `${product.brand} · ` : ""}{product.sku}</span><h2>{product.name}</h2>
            <strong className="shop-product__price">{formatPrice(product.sellingPrice)} <small>/ {product.unit}</small></strong>
            <span className={`shop-product__stock${branchId && product.availableQuantity === 0 ? " shop-product__stock--empty" : ""}`}>
              {!branchId ? "Choose a branch to check stock" : product.availableQuantity > 0
                ? `${product.availableQuantity} available at ${selectedBranch?.name || "this branch"}` : `Out of stock at ${selectedBranch?.name || "this branch"}`}
            </span>
          </div>
        </Link>
        <div className="shop-product__actions"><button className="shop-product__button" type="button"
          disabled={Boolean(branchId && product.availableQuantity === 0)} onClick={() => handleAddToCart(product)}>{branchId && product.availableQuantity === 0 ? "Out of stock" : "Add to cart"}</button></div>
      </article>)}</div>
    ) : (
      <div className="shop-products__empty"><MagnifyingGlass size={32} aria-hidden="true" /><h2>{products.length ? "No products found" : "No products available"}</h2>
        <p>{products.length ? "Try a different search or browse all products." : "Please check back later."}</p>
        {products.length > 0 && <button className="shop-button shop-button--outline" type="button" onClick={resetFilters}>View all products</button>}
      </div>
    )}
  </main>;
}
