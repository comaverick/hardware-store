import { useState } from "react";
import {
  ArrowRight,
  CaretDown,
  CheckCircle,
  ClipboardText,
  Drop,
  Hammer,
  HardHat,
  Heart,
  House,
  Lightning,
  List,
  MagnifyingGlass,
  MapPin,
  PaintBrush,
  ShoppingCart,
  SquaresFour,
  Storefront,
  Truck,
  UserCircle,
  Wrench,
  X,
} from "@phosphor-icons/react";
import heroImage from "./assets/hardware-hero.webp";
import drillImage from "./assets/product-drill.webp";
import hammerImage from "./assets/product-hammer.webp";
import paintImage from "./assets/product-paint.webp";
import fastenersImage from "./assets/product-fasteners.webp";
import "./App.css";
import { useReservationCart } from "./cart/reservationCart";

const categories = [
  { name: "Tools", detail: "Hand and power", Icon: Hammer },
  { name: "Paint", detail: "Color and supplies", Icon: PaintBrush },
  { name: "Electrical", detail: "Safe connections", Icon: Lightning },
  { name: "Plumbing", detail: "Pipes and fittings", Icon: Drop },
  { name: "Hardware", detail: "Fasteners and locks", Icon: Wrench },
  { name: "Safety", detail: "Worksite essentials", Icon: HardHat },
];

const products = [
  {
    name: "18V Cordless Drill Set",
    category: "Power tools",
    price: "₱3,490",
    stock: "Available today",
    image: drillImage,
  },
  {
    name: "Steel Claw Hammer",
    category: "Hand tools",
    price: "₱445",
    stock: "Available today",
    image: hammerImage,
  },
  {
    name: "Interior Paint Starter Set",
    category: "Paint supplies",
    price: "₱1,280",
    stock: "Limited stock",
    image: paintImage,
  },
  {
    name: "Screw and Anchor Kit",
    category: "Fasteners",
    price: "₱690",
    stock: "Available today",
    image: fastenersImage,
  },
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const cart = useReservationCart();

  return (
    <div className="storefront-shell">
      <div className="service-strip">
        <div className="page-width service-strip__content">
          <span>Reserve online. Pick up at your preferred branch.</span>
          <button type="button">How pickup works</button>
        </div>
      </div>

      <header className="site-header">
        <div className="page-width header-row">
          <a className="brand" href="#top" aria-label="Hardware Store home">
            <span className="brand__mark" aria-hidden="true">
              HS
            </span>
            <span className="brand__name">Hardware Store</span>
          </a>

          <nav className="desktop-nav" aria-label="Primary navigation">
            <a href="#categories">Categories</a>
            <a href="#products">Best sellers</a>
            <a href="#pickup">Branch pickup</a>
            <a href="/scanspace">ScanSpace</a>
          </nav>

          <div className="header-actions">
            <button className="location-button" type="button">
              <MapPin size={19} weight="bold" />
              <span>Choose branch</span>
              <CaretDown size={14} weight="bold" />
            </button>
            <button
              className="icon-button account-button"
              type="button"
              aria-label="Customer account"
            >
              <UserCircle size={24} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Reservation cart"
              onClick={cart.show}
            >
              <ShoppingCart size={23} />
              <span className="cart-count">
                {cart.draft?.items?.reduce(
                  (sum, item) => sum + item.quantity,
                  0,
                ) || 0}
              </span>
            </button>
            <button
              className="icon-button menu-button"
              type="button"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
            >
              {menuOpen ? <X size={24} /> : <List size={25} />}
            </button>
          </div>
        </div>

        <div className="page-width search-row">
          <label className="search-box">
            <span className="visually-hidden">Search products</span>
            <MagnifyingGlass size={22} aria-hidden="true" />
            <input placeholder="What are you looking for?" />
            <button type="button">Search</button>
          </label>
          <button className="orders-button" type="button">
            <ClipboardText size={21} />
            My reservations
          </button>
        </div>

        {menuOpen && (
          <nav className="mobile-menu" aria-label="Mobile navigation">
            <a href="#categories" onClick={() => setMenuOpen(false)}>
              Categories
            </a>
            <a href="#products" onClick={() => setMenuOpen(false)}>
              Best sellers
            </a>
            <a href="#pickup" onClick={() => setMenuOpen(false)}>
              Branch pickup
            </a>
            <button type="button">
              <MapPin size={20} /> Choose branch
            </button>
          </nav>
        )}
      </header>

      <main id="top">
        <div className="page-width scanspace-entry">
          <a href="/scanspace">
            <SquaresFour size={20} />
            <span>
              <strong>Meet ScanSpace</strong> Scan your room. Try a new look.
              Plan your materials.
            </span>
            <ArrowRight size={20} />
          </a>
        </div>
        <section className="hero page-width" aria-labelledby="hero-title">
          <div className="hero__copy">
            <p className="eyebrow">For home and trade</p>
            <h1 id="hero-title">Everything your project needs.</h1>
            <p className="hero__body">
              Check local stock, reserve online, and pick up from the branch
              nearest you.
            </p>
            <div className="hero__actions">
              <a className="button button--primary" href="#products">
                Shop now <ArrowRight size={18} weight="bold" />
              </a>
              <a className="button button--secondary" href="#categories">
                Browse categories
              </a>
            </div>
          </div>
          <div className="hero__visual">
            <img
              src={heroImage}
              alt="Organized hardware store shelves and tools"
              fetchPriority="high"
            />
          </div>
        </section>

        <section
          className="assurance page-width"
          aria-label="Reservation benefits"
        >
          <div>
            <CheckCircle size={23} weight="fill" />
            <span>
              <strong>Live branch stock</strong>Know what is available before
              visiting.
            </span>
          </div>
          <div>
            <Storefront size={23} weight="fill" />
            <span>
              <strong>Easy reservation</strong>Set items aside without online
              payment.
            </span>
          </div>
          <div>
            <Truck size={24} weight="fill" />
            <span>
              <strong>Convenient pickup</strong>Choose the branch that works for
              you.
            </span>
          </div>
        </section>

        <section className="section page-width" id="categories">
          <div className="section-heading">
            <h2>Shop by category</h2>
            <p>Start with the job, then find the exact supplies.</p>
          </div>
          <div className="category-grid">
            {categories.map(({ name, detail, Icon }) => (
              <button className="category-tile" type="button" key={name}>
                <span className="category-tile__icon">
                  <Icon size={27} weight="duotone" />
                </span>
                <span>
                  <strong>{name}</strong>
                  <small>{detail}</small>
                </span>
                <ArrowRight size={17} weight="bold" />
              </button>
            ))}
          </div>
        </section>

        <section className="section section--products" id="products">
          <div className="page-width">
            <div className="section-heading section-heading--action">
              <div>
                <h2>Ready for your next job</h2>
                <p>
                  Popular supplies shown with sample prices and availability.
                </p>
              </div>
              <button className="text-link" type="button">
                View all <ArrowRight size={17} />
              </button>
            </div>

            <div className="product-grid">
              {products.map((product) => (
                <article className="product-card" key={product.name}>
                  <div className="product-card__image">
                    <img
                      src={product.image}
                      alt={product.name}
                      loading="lazy"
                    />
                    <button
                      className="favorite-button"
                      type="button"
                      aria-label={`Save ${product.name}`}
                    >
                      <Heart size={20} />
                    </button>
                  </div>
                  <div className="product-card__content">
                    <span className="product-card__category">
                      {product.category}
                    </span>
                    <h3>{product.name}</h3>
                    <div className="product-card__meta">
                      <strong>{product.price}</strong>
                      <span>{product.stock}</span>
                    </div>
                    <button className="reserve-button" type="button">
                      Reserve item
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="pickup page-width" id="pickup">
          <div className="pickup__icon" aria-hidden="true">
            <MapPin size={39} weight="duotone" />
          </div>
          <div className="pickup__copy">
            <h2>Pick up where it suits you.</h2>
            <p>
              Select a branch to see local availability and reserve supplies
              before making the trip.
            </p>
          </div>
          <button className="button button--primary" type="button">
            Choose a branch
          </button>
        </section>

        <section className="project-callout page-width">
          <div>
            <span className="project-callout__icon">
              <SquaresFour size={26} weight="duotone" />
            </span>
            <h2>Not sure what fits?</h2>
            <p>
              Use BuildMatch to identify a part and find compatible products in
              stock.
            </p>
          </div>
          <button className="button button--secondary" type="button">
            Try BuildMatch
          </button>
        </section>
      </main>

      <footer className="site-footer">
        <div className="page-width footer-grid">
          <div>
            <a className="brand brand--footer" href="#top">
              <span className="brand__mark" aria-hidden="true">
                HS
              </span>
              <span className="brand__name">Hardware Store</span>
            </a>
            <p>Reserve dependable supplies from your local branch.</p>
          </div>
          <div>
            <strong>Shop</strong>
            <a href="#categories">Categories</a>
            <a href="#products">Products</a>
            <a href="#pickup">Branches</a>
          </div>
          <div>
            <strong>Customer care</strong>
            <a href="#top">How reservations work</a>
            <a href="#top">Contact us</a>
            <a href="#top">FAQs</a>
          </div>
        </div>
        <div className="page-width footer-bottom">
          <span>© 2026 Hardware Store. Layout preview.</span>
          <span>Privacy</span>
        </div>
      </footer>

      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        <a href="#top" className="is-active">
          <House size={22} weight="fill" />
          <span>Home</span>
        </a>
        <a href="#categories">
          <SquaresFour size={22} />
          <span>Browse</span>
        </a>
        <button type="button">
          <ClipboardText size={22} />
          <span>Reservations</span>
        </button>
        <button type="button">
          <UserCircle size={22} />
          <span>Account</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
