import { useEffect, useState } from "react";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useInRouterContext,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
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
import { fetchStorefrontCatalog, formatPrice, productImageUrl } from "./storefrontCatalog";
import ProductDetails from "./pages/ProductDetails";
import "./App.css";

export const categoryIcons = {
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

export function ProductVisual({ product }) {
  const image = productImageUrl(product?.image);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  if (image && !failed) {
    return <img src={image} alt={product?.name || "Product"} loading="lazy" onError={() => setFailed(true)} />;
  }
  const Icon = categoryIcons[product?.category] || SquaresFour;
  return <Icon className="shop-product__placeholder" size={58} weight="duotone" aria-hidden="true" />;
}

function Brand({ footer = false }) {
  return (
    <Link
      className={`shop-brand${footer ? " shop-brand--footer" : ""}`}
      to="/"
      aria-label="Hardware Store home"
    >
      <span className="shop-brand__mark" aria-hidden="true">
        HS
      </span>
      <span>Hardware Store</span>
    </Link>
  );
}

function CatalogContent({
  activeCategory,
  resetFilters,
  chooseCategory,
  categories,
  branchId,
  setBranchId,
  branches,
  selectedBranch,
  visibleProducts,
  loading,
  error,
  setRetryKey,
  query,
  handleAddToCart,
  products,
  show,
}) {
  return (
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
            <small>Choose a branch to check stock.</small>
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
            const Icon = categoryIcons[category] || SquaresFour;
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
          {!categories.length && (
            <p className="shop-categories__status">
              {loading ? "Loading categories…" : "Categories will appear when products are available."}
            </p>
          )}
        </div>
      </section>

      <section className="shop-container shop-section shop-products" id="products">
        <div className="shop-section__heading">
          <div>
            <h2>{activeCategory === "All" ? "Shop products" : activeCategory}</h2>
            <p>Current catalog prices. Stock is shown for your chosen branch.</p>
          </div>
          {(activeCategory !== "All" || query) && (
            <button className="shop-text-button" type="button" onClick={resetFilters}>
              View all products <ArrowRight size={17} />
            </button>
          )}
        </div>
        <div className="shop-products__controls">
          <label htmlFor="shop-branch">Check stock at</label>
          <select
            id="shop-branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            disabled={!branches.length}
          >
            <option value="">Choose a branch</option>
            {branches.map((branch) => (
              <option key={branch._id} value={branch._id}>{branch.name}</option>
            ))}
          </select>
        </div>
        {loading ? (
          <div className="shop-products__empty" role="status">Loading products…</div>
        ) : error ? (
          <div className="shop-products__empty" role="alert">
            <h3>Products are unavailable</h3>
            <p>{error}</p>
            <button className="shop-button shop-button--outline" type="button" onClick={() => setRetryKey((value) => value + 1)}>
              Try again
            </button>
          </div>
        ) : visibleProducts.length ? (
          <div className="shop-products__grid">
            {visibleProducts.map((product) => (
              <article className="shop-product" key={product._id}>
                <Link
                  to={`/products/${product._id}`}
                  className="shop-product__card-link"
                  aria-label={`View details for ${product.name}`}
                >
                  <div className="shop-product__image">
                    <ProductVisual product={product} />
                  </div>
                  <div className="shop-product__details">
                    <span className="shop-product__category">{product.brand ? `${product.brand} · ` : ""}{product.sku}</span>
                    <h3>{product.name}</h3>
                    <strong className="shop-product__price">{formatPrice(product.sellingPrice)} <small>/ {product.unit}</small></strong>
                    <span className={`shop-product__stock${branchId && product.availableQuantity === 0 ? " shop-product__stock--empty" : ""}`}>
                      <span aria-hidden="true" />
                      {!branchId
                        ? "Choose a branch to check stock"
                        : product.availableQuantity > 0
                          ? `${product.availableQuantity} available at ${selectedBranch?.name || "this branch"}`
                          : `Out of stock at ${selectedBranch?.name || "this branch"}`}
                    </span>
                  </div>
                </Link>
                <div className="shop-product__actions">
                  <button
                    className="shop-product__button"
                    type="button"
                    disabled={Boolean(branchId && product.availableQuantity === 0)}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddToCart(product);
                    }}
                  >
                    {branchId && product.availableQuantity === 0 ? "Out of stock" : "Add to cart"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="shop-products__empty">
            <MagnifyingGlass size={28} aria-hidden="true" />
            <h3>{products.length ? "No products found" : "No products available"}</h3>
            <p>{products.length ? "Try a different search or browse all products." : "Please check back later."}</p>
            {products.length > 0 && (
              <button className="shop-button shop-button--outline" type="button" onClick={resetFilters}>
                View all products
              </button>
            )}
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
  );
}

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const { draft, show, addItem } = useReservationCart();

  useEffect(() => {
    const cat = searchParams.get("category");
    if (cat) {
      setActiveCategory(cat);
    }
    const search = searchParams.get("search");
    if (search !== null) {
      setQuery(search);
    }
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setError("");
    setProducts([]);
    fetchStorefrontCatalog(branchId, controller.signal)
      .then((catalog) => {
        if (!active) return;
        setProducts(catalog.products);
        setBranches(catalog.branches);
      })
      .catch(() => {
        if (active) setError("Store catalog could not load. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
        window.clearTimeout(timer);
      });
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [branchId, retryKey]);

  const categories = [...new Set(products.map((product) => product.category || "Other"))]
    .sort((left, right) => left.localeCompare(right));
  const selectedBranch = branches.find((branch) => branch._id === branchId);
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
      `${product.name} ${product.category} ${product.description} ${product.sku} ${product.brand}`
        .toLowerCase()
        .includes(normalizedQuery);
    return matchesCategory && matchesSearch;
  });

  function resetFilters() {
    setActiveCategory("All");
    setQuery("");
    if (location.pathname !== "/" && location.pathname !== "/products") {
      navigate("/");
    }
  }

  function chooseCategory(category) {
    setActiveCategory(category);
    setQuery("");
    if (location.pathname !== "/" && location.pathname !== "/products") {
      navigate(`/?category=${encodeURIComponent(category)}`);
      setTimeout(() => {
        document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    } else {
      document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
    }
  }

  function handleSearch(event) {
    event.preventDefault();
    if (location.pathname !== "/" && location.pathname !== "/products") {
      navigate(`/?search=${encodeURIComponent(query)}`);
      setTimeout(() => {
        document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    } else {
      document.getElementById("products")?.scrollIntoView({ behavior: "smooth" });
    }
  }

  function handleAddToCart(product) {
    addItem({
      id: product._id,
      name: product.name,
      price: product.sellingPrice,
      image: productImageUrl(product.image),
    });
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
          <a className="shop-header__pickup" href="/#pickup">
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

      <Routes>
        <Route
          path="/"
          element={
            <CatalogContent
              activeCategory={activeCategory}
              resetFilters={resetFilters}
              chooseCategory={chooseCategory}
              categories={categories}
              branchId={branchId}
              setBranchId={setBranchId}
              branches={branches}
              selectedBranch={selectedBranch}
              visibleProducts={visibleProducts}
              loading={loading}
              error={error}
              setRetryKey={setRetryKey}
              query={query}
              handleAddToCart={handleAddToCart}
              products={products}
              show={show}
            />
          }
        />
        <Route
          path="/products"
          element={
            <CatalogContent
              activeCategory={activeCategory}
              resetFilters={resetFilters}
              chooseCategory={chooseCategory}
              categories={categories}
              branchId={branchId}
              setBranchId={setBranchId}
              branches={branches}
              selectedBranch={selectedBranch}
              visibleProducts={visibleProducts}
              loading={loading}
              error={error}
              setRetryKey={setRetryKey}
              query={query}
              handleAddToCart={handleAddToCart}
              products={products}
              show={show}
            />
          }
        />
        <Route
          path="/products/:id"
          element={
            <ProductDetails
              cachedProducts={products}
              cachedBranches={branches}
              initialBranchId={branchId}
              onBranchChange={(newBranchId) => setBranchId(newBranchId)}
            />
          }
        />
        <Route
          path="/product/:id"
          element={
            <ProductDetails
              cachedProducts={products}
              cachedBranches={branches}
              initialBranchId={branchId}
              onBranchChange={(newBranchId) => setBranchId(newBranchId)}
            />
          }
        />
        <Route
          path="*"
          element={
            <CatalogContent
              activeCategory={activeCategory}
              resetFilters={resetFilters}
              chooseCategory={chooseCategory}
              categories={categories}
              branchId={branchId}
              setBranchId={setBranchId}
              branches={branches}
              selectedBranch={selectedBranch}
              visibleProducts={visibleProducts}
              loading={loading}
              error={error}
              setRetryKey={setRetryKey}
              query={query}
              handleAddToCart={handleAddToCart}
              products={products}
              show={show}
            />
          }
        />
      </Routes>

      <footer className="shop-footer">
        <div className="shop-container shop-footer__main">
          <div>
            <Brand footer />
            <p>Dependable supplies for home and trade.</p>
          </div>
          <div>
            <strong>Shop</strong>
            <a href="#categories" onClick={() => { if (location.pathname !== "/") navigate("/#categories"); }}>Categories</a>
            <Link to="/" onClick={resetFilters}>Products</Link>
            <a href="#pickup" onClick={() => { if (location.pathname !== "/") navigate("/#pickup"); }}>Branch pickup</a>
          </div>
          <div>
            <strong>Explore</strong>
            <a href="/scanspace">ScanSpace</a>
            <button type="button" onClick={show}>Reservation cart</button>
          </div>
        </div>
        <div className="shop-container shop-footer__bottom">
          <span>© {new Date().getFullYear()} Hardware Store.</span>
          <span>Prices and stock may change. Confirm with your branch.</span>
        </div>
      </footer>

      <nav className="shop-mobile-nav" aria-label="Mobile navigation">
        <Link to="/"><House size={22} weight="fill" /><span>Home</span></Link>
        <a href="#categories" onClick={() => { if (location.pathname !== "/") navigate("/#categories"); }}><SquaresFour size={22} /><span>Browse</span></a>
        <button type="button" onClick={show}><ShoppingCart size={22} /><span>Cart</span></button>
        <a href="/scanspace"><Wrench size={22} /><span>ScanSpace</span></a>
      </nav>
    </div>
  );
}

export default function App() {
  const inRouter = useInRouterContext();
  if (!inRouter) {
    return (
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>
    );
  }
  return <AppContent />;
}
