import { useEffect, useState } from "react";
import {
  Link, MemoryRouter, Navigate, NavLink, Route, Routes, useInRouterContext,
  useLocation, useNavigate, useSearchParams,
} from "react-router-dom";
import { ArrowRight, House, MagnifyingGlass, ShoppingCart, SquaresFour, UserCircle, Wrench } from "@phosphor-icons/react";
import { useReservationCart } from "./cart/reservationCart";
import { fetchStorefrontCatalog, productImageUrl } from "./storefrontCatalog";
import ProductDetails from "./pages/ProductDetails";
import HomePage from "./pages/HomePage";
import ProductsPage from "./pages/ProductsPage";
import AppearancePicker, { useStoreAppearance } from "./storefront/AppearancePicker";
import { CustomerAuthBoundary, useCustomerAuth } from "./auth/CustomerAuthContext";
import { AccountPage, ForgotPasswordPage, SignInPage, VerifyEmailPage } from "./auth/AccountPages";
import "./storefront/theme.css";
import "./App.css";

export { categoryIcons, ProductVisual } from "./storefront/ProductVisual";

function Brand({ footer = false }) {
  return <Link className={`shop-brand${footer ? " shop-brand--footer" : ""}`} to="/" aria-label="HS Hardware Store home">
    <span className="shop-brand__mark">HS</span>{" "}<span>Hardware Store</span>
  </Link>;
}

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("search") || "");
  const activeCategory = searchParams.get("category") || "All";
  const appliedQuery = searchParams.get("search") || "";
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const { draft, show, addItem } = useReservationCart();
  const { session } = useCustomerAuth();
  const appearance = useStoreAppearance((state) => state.appearance);
  const accountPath = session ? "/account" : "/login";
  const accountState = { from: location.pathname + location.search };
  const onAccountPage = ["/account", "/login", "/register", "/forgot-password", "/verify-email"].includes(location.pathname);
  const onProductsPage = location.pathname === "/products";
  const inProducts = location.pathname.startsWith("/products") || location.pathname.startsWith("/product/");

  useEffect(() => { setQuery(appliedQuery); }, [appliedQuery, location.pathname]);
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    else window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname, location.hash]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setError("");
    fetchStorefrontCatalog(branchId, controller.signal)
      .then((catalog) => {
        if (!active) return;
        setProducts(catalog.products);
        setBranches(catalog.branches);
      })
      .catch(() => { if (active) setError("Store catalog could not load. Please try again."); })
      .finally(() => {
        if (active) setLoading(false);
        window.clearTimeout(timer);
      });
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [branchId, retryKey]);

  const categories = [...new Set(products.map((product) => product.category || "Other"))]
    .sort((left, right) => left.localeCompare(right));
  const selectedBranch = branches.find((branch) => branch._id === branchId);
  const cartCount = draft?.items?.reduce((total, item) => total + Number(item.quantity || 0), 0) || 0;
  const normalizedQuery = appliedQuery.trim().toLowerCase();
  const visibleProducts = products.filter((product) => {
    const matchesCategory = activeCategory === "All" || (product.category || "Other") === activeCategory;
    const matchesSearch = !normalizedQuery ||
      `${product.name} ${product.category} ${product.description} ${product.sku} ${product.brand}`.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesSearch;
  });

  function productsPath(search, category = activeCategory) {
    const params = new URLSearchParams();
    if (category !== "All") params.set("category", category);
    if (search.trim()) params.set("search", search);
    const encoded = params.toString();
    return `/products${encoded ? `?${encoded}` : ""}`;
  }
  function resetFilters() { setQuery(""); navigate("/products"); }
  function chooseCategory(category) { setQuery(""); navigate(productsPath("", category)); }
  function changeSearch(value) {
    setQuery(value);
    if (onProductsPage) navigate(productsPath(value), { replace: true });
  }
  function handleSearch(event) {
    event.preventDefault();
    navigate(productsPath(query, onProductsPage ? activeCategory : "All"));
  }
  function handleAddToCart(product) {
    addItem({ id: product._id, name: product.name, price: product.sellingPrice, image: productImageUrl(product.image) });
  }
  const productDetails = <ProductDetails cachedProducts={products} cachedBranches={branches}
    initialBranchId={branchId} onBranchChange={setBranchId} />;

  return <div className="storefront-shell" id="top" data-theme={appearance}>
    <a className="shop-skip-link" href="#main-content">Skip to content</a>
    <header className={`shop-header${onAccountPage ? " shop-header--account" : ""}`}>
      <div className="shop-container shop-header__main">
        <Brand />
        <nav className="shop-header__nav" aria-label="Main navigation">
          <NavLink to="/" end>Home</NavLink>
          <Link to="/products" aria-current={inProducts ? "page" : undefined}>Products</Link>
          <Link to="/scanspace">ScanSpace</Link>
        </nav>
        {!onAccountPage && <form className="shop-search" role="search" onSubmit={handleSearch}>
          <MagnifyingGlass size={19} aria-hidden="true" />
          <input aria-label="Search products" placeholder="Search products" value={query}
            onChange={(event) => changeSearch(event.target.value)} type="search" />
          <button type="submit" aria-label="Show search results"><ArrowRight size={18} aria-hidden="true" /></button>
        </form>}
        <div className="shop-header__actions">
          <AppearancePicker />
          <Link className="shop-icon-button" to={accountPath} state={accountState}
            aria-label={session ? "Your account" : "Sign in"} title={session ? "Your account" : "Sign in"}>
            <UserCircle size={24} aria-hidden="true" />
          </Link>
          <button className="shop-icon-button shop-header__cart" type="button"
            aria-label={`Reservation cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`} title="Cart" onClick={show}>
            <ShoppingCart size={23} aria-hidden="true" />{cartCount > 0 && <small>{cartCount}</small>}
          </button>
        </div>
      </div>
    </header>
    <div id="main-content" className="shop-page-content" tabIndex={-1}>
      <Routes>
        <Route path="/login" element={<SignInPage key="login" />} />
        <Route path="/register" element={<SignInPage key="register" register />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/" element={<HomePage categories={categories} loading={loading} error={error}
          onRetry={() => setRetryKey((value) => value + 1)} showCart={show} />} />
        <Route path="/products" element={<ProductsPage activeCategory={activeCategory} resetFilters={resetFilters}
          chooseCategory={chooseCategory} categories={categories} branchId={branchId} setBranchId={setBranchId}
          branches={branches} selectedBranch={selectedBranch} visibleProducts={visibleProducts} loading={loading}
          error={error} onRetry={() => setRetryKey((value) => value + 1)} query={appliedQuery}
          handleAddToCart={handleAddToCart} products={products} />} />
        <Route path="/products/:id" element={productDetails} />
        <Route path="/product/:id" element={productDetails} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
    <footer className="shop-footer">
      <div className="shop-container shop-footer__main">
        <div><Brand footer /><p>Dependable supplies for home and trade.</p></div>
        <nav aria-label="Footer navigation">
          <Link to="/products">Products</Link><Link to="/scanspace">ScanSpace</Link>
          <Link to="/#pickup">Branch pickup</Link>
          <Link to={accountPath} state={accountState}>{session ? "Your account" : "Sign in"}</Link>
        </nav>
      </div>
      <div className="shop-container shop-footer__bottom"><span>© {new Date().getFullYear()} Hardware Store.</span>
        <span>Prices and stock may change. Confirm with your branch.</span></div>
    </footer>
    <nav className="shop-mobile-nav" aria-label="Mobile navigation">
      <NavLink to="/" end><House size={23} aria-hidden="true" /><span>Home</span></NavLink>
      <Link to="/products" aria-current={inProducts ? "page" : undefined}><SquaresFour size={23} aria-hidden="true" /><span>Products</span></Link>
      <button type="button" onClick={show}><ShoppingCart size={23} aria-hidden="true" /><span>Cart{cartCount ? ` (${cartCount})` : ""}</span></button>
      <Link to="/scanspace"><Wrench size={23} aria-hidden="true" /><span>ScanSpace</span></Link>
      <Link to={accountPath} state={accountState} aria-current={onAccountPage ? "page" : undefined}><UserCircle size={23} aria-hidden="true" /><span>Account</span></Link>
    </nav>
  </div>;
}

export default function App() {
  const inRouter = useInRouterContext();
  if (!inRouter) return <MemoryRouter initialEntries={["/"]}><CustomerAuthBoundary><AppContent /></CustomerAuthBoundary></MemoryRouter>;
  return <CustomerAuthBoundary><AppContent /></CustomerAuthBoundary>;
}
