import { useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  ClipboardText,
  Drop,
  Hammer,
  HardHat,
  House,
  Lightning,
  MagnifyingGlass,
  MapPin,
  PaintBrush,
  ShoppingCart,
  SquaresFour,
  Storefront,
  Wrench,
} from "@phosphor-icons/react";
import heroImage from "./assets/hardware-hero-minimal.webp";
import scanSpaceImage from "./assets/scanspace-room-feature.webp";
import { useReservationCart } from "./cart/reservationCart";
import { categories, formatPrice, products } from "./storefrontCatalog";
import "./App.css";

const categoryIcons = {
  Tools: Hammer,
  Paint: PaintBrush,
  Electrical: Lightning,
  Plumbing: Drop,
  Hardware: Wrench,
  Safety: HardHat,
};

function Brand({ footer = false }) {
  return (
    <a
      className={`shop-brand${footer ? " shop-brand--footer" : ""}`}
      href="#top"
      aria-label="Hardware Store home"
    >
      <span className="shop-brand__mark" aria-hidden="true">
        HS
      </span>
      <span>Hardware Store</span>
    </a>
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const { draft, show, addItem } = useReservationCart();
  const cartCount = draft?.items?.reduce(
    (total, item) => total + Number(item.quantity || 0),
    0,
  ) || 0;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = products.filter((product) => {
    const matchesCategory =
      activeCategory === "All" || product.category === activeCategory;
    const matchesSearch =
      !normalizedQuery ||
      `${product.name} ${product.category} ${product.detail}`
        .toLowerCase()
        .includes(normalizedQuery);
    return matchesCategory && matchesSearch;
  });

  function resetFilters() {
    setActiveCategory("All");
    setQuery("");
  }

  function chooseCategory(category) {
    setActiveCategory(category);
    setQuery("");
  }

  function handleSearch(event) {
    event.preventDefault();
    document.getElementById("products")?.scrollIntoView();
  }

  return (
    <div className="storefront-shell" id="top">
      <header className="shop-header">
        <div className="shop-container shop-header__main">
          <Brand />
          <form className="shop-search" role="search" onSubmit={handleSearch}>
            <MagnifyingGlass size={20} aria-hidden="true" />
            <input
              aria-label="Search products"
              placeholder="Search products"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
            />
            <button type="submit" aria-label="Show search results">
              <ArrowRight size={19} weight="bold" />
            </button>
          </form>
          <a className="shop-header__pickup" href="#pickup">
            <MapPin size={21} weight="bold" />
            <span>Branch pickup</span>
          </a>
          <button
            className="shop-header__cart"
            type="button"
            aria-label={`Reservation cart, ${cartCount} items`}
            onClick={show}
          >
            <ShoppingCart size={23} />
            <span>Cart</span>
            {cartCount > 0 && <small>{cartCount}</small>}
          </button>
        </div>
        <nav className="shop-container shop-header__nav" aria-label="Shop categories">
          {categories.map((category) => (
            <a
              href="#products"
              key={category}
              onClick={() => chooseCategory(category)}
              aria-current={activeCategory === category ? "true" : undefined}
            >
              {category}
            </a>
          ))}
          <a className="shop-header__scanspace" href="/scanspace">
            ScanSpace
          </a>
        </nav>
      </header>

      <main>
        <div className="shop-container shop-hero-layout">
          <section className="shop-hero" aria-labelledby="shop-hero-title">
            <div className="shop-hero__copy">
              <h1 id="shop-hero-title">Everything for your next project.</h1>
              <p>Tools and materials for home and trade.</p>
              <a className="shop-button shop-button--primary" href="#products" onClick={resetFilters}>
                Shop products <ArrowRight size={18} weight="bold" />
              </a>
            </div>
            <div className="shop-hero__image">
              <img
                src={heroImage}
                alt="Cordless drill, paint and tools arranged on a light workbench"
                fetchPriority="high"
              />
            </div>
          </section>

          <a className="shop-scan-feature" href="/scanspace">
            <div className="shop-scan-feature__copy">
              <span className="shop-scan-feature__eyebrow">ScanSpace · Room planning</span>
              <h2>See your space before you build.</h2>
              <p>Try finishes and plan materials in your room.</p>
              <span className="shop-scan-feature__link">
                Explore ScanSpace <ArrowRight size={17} weight="bold" aria-hidden="true" />
              </span>
            </div>
            <img className="shop-scan-feature__image" src={scanSpaceImage} alt="" />
          </a>
        </div>

        <section className="shop-container shop-benefits" aria-label="Shopping benefits">
          <div>
            <CheckCircle size={26} aria-hidden="true" />
            <span>
              <strong>Local stock</strong>
              <small>Check what your branch has.</small>
            </span>
          </div>
          <div>
            <ClipboardText size={26} aria-hidden="true" />
            <span>
              <strong>Reserve online</strong>
              <small>Keep your items in one place.</small>
            </span>
          </div>
          <div>
            <Storefront size={27} aria-hidden="true" />
            <span>
              <strong>Branch pickup</strong>
              <small>Collect from your chosen store.</small>
            </span>
          </div>
        </section>

        <section className="shop-container shop-section" id="categories">
          <div className="shop-section__heading">
            <div>
              <h2>Shop by category</h2>
              <p>Find the right supplies for the job.</p>
            </div>
          </div>
          <div className="shop-categories">
            {categories.map((category) => {
              const Icon = categoryIcons[category];
              return (
                <a
                  className="shop-category"
                  href="#products"
                  key={category}
                  onClick={() => chooseCategory(category)}
                >
                  <span className="shop-category__image">
                    <Icon size={43} weight="duotone" aria-hidden="true" />
                  </span>
                  <strong>{category}</strong>
                </a>
              );
            })}
          </div>
        </section>

        <section className="shop-container shop-section shop-products" id="products">
          <div className="shop-section__heading">
            <div>
              <h2>{activeCategory === "All" ? "Popular products" : activeCategory}</h2>
              <p>Sample prices and availability. Confirm with your branch before pickup.</p>
            </div>
            {(activeCategory !== "All" || query) && (
              <button className="shop-text-button" type="button" onClick={resetFilters}>
                View all products <ArrowRight size={17} />
              </button>
            )}
          </div>
          {visibleProducts.length ? (
            <div className="shop-products__grid">
              {visibleProducts.map((product) => (
                <article className="shop-product" key={product.id}>
                  <div className="shop-product__image">
                    <img src={product.image} alt={product.name} loading="lazy" />
                  </div>
                  <div className="shop-product__details">
                    <span className="shop-product__category">{product.detail}</span>
                    <h3>{product.name}</h3>
                    <strong className="shop-product__price">{formatPrice(product.price)}</strong>
                    <span className="shop-product__stock">
                      <span aria-hidden="true" />
                      {product.stock}
                    </span>
                    <button
                      className="shop-product__button"
                      type="button"
                      onClick={() => addItem(product)}
                    >
                      Add to cart
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="shop-products__empty">
              <MagnifyingGlass size={28} aria-hidden="true" />
              <h3>No sample products found</h3>
              <p>Try a different search or browse all products.</p>
              <button className="shop-button shop-button--outline" type="button" onClick={resetFilters}>
                View all products
              </button>
            </div>
          )}
        </section>

        <section className="shop-container shop-pickup" id="pickup">
          <div className="shop-pickup__intro">
            <MapPin size={25} weight="duotone" aria-hidden="true" />
            <div>
              <h2>Easy branch pickup</h2>
              <p>Get your supplies in a few simple steps.</p>
            </div>
          </div>
          <ol>
            <li><b>1</b><span><strong>Shop supplies</strong><small>Find the items you need.</small></span></li>
            <li><b>2</b><span><strong>Review your cart</strong><small>Keep a saved draft of your items.</small></span></li>
            <li><b>3</b><span><strong>Confirm pickup</strong><small>Check stock and price with your branch.</small></span></li>
          </ol>
          <button className="shop-button shop-button--primary" type="button" onClick={show}>
            View cart
          </button>
        </section>

        <section className="shop-container shop-buildmatch" aria-label="BuildMatch">
          <SquaresFour size={27} weight="duotone" aria-hidden="true" />
          <div>
            <h2>Find the right materials for your project.</h2>
            <p>BuildMatch product recommendations are coming soon.</p>
          </div>
          <span>Coming soon</span>
        </section>
      </main>

      <footer className="shop-footer">
        <div className="shop-container shop-footer__main">
          <div>
            <Brand footer />
            <p>Dependable supplies for home and trade.</p>
          </div>
          <div>
            <strong>Shop</strong>
            <a href="#categories">Categories</a>
            <a href="#products" onClick={resetFilters}>Products</a>
            <a href="#pickup">Branch pickup</a>
          </div>
          <div>
            <strong>Explore</strong>
            <a href="/scanspace">ScanSpace</a>
            <button type="button" onClick={show}>Reservation cart</button>
          </div>
        </div>
        <div className="shop-container shop-footer__bottom">
          <span>© {new Date().getFullYear()} Hardware Store.</span>
          <span>Prices and stock shown are samples.</span>
        </div>
      </footer>

      <nav className="shop-mobile-nav" aria-label="Mobile navigation">
        <a href="#top"><House size={22} weight="fill" /><span>Home</span></a>
        <a href="#categories"><SquaresFour size={22} /><span>Browse</span></a>
        <button type="button" onClick={show}><ShoppingCart size={22} /><span>Cart</span></button>
        <a href="/scanspace"><Wrench size={22} /><span>ScanSpace</span></a>
      </nav>
    </div>
  );
}

export default App;
