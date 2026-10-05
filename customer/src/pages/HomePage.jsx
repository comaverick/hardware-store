import { Link } from "react-router-dom";
import { ArrowRight, MapPin, SquaresFour } from "@phosphor-icons/react";
import scanSpaceImage from "../assets/scanspace-room-feature.webp";
import { categoryIcons } from "../storefront/ProductVisual";

// Public URL lets the document preload the hero before the React bundle starts.
const heroImage = `${process.env.PUBLIC_URL || ""}/images/hardware-hero-minimal.webp`;

export default function HomePage({ categories, loading, error, onRetry, showCart }) {
  return <main className="shop-home">
    <section className="shop-container shop-hero" aria-labelledby="shop-hero-title">
      <div className="shop-hero__copy">
        <h1 id="shop-hero-title"><span>Everything for</span>{" "}<span>your next project.</span></h1>
        <p>Tools and materials for home and trade.</p>
        <Link className="shop-button shop-button--primary" to="/products">Shop products <ArrowRight size={18} aria-hidden="true" /></Link>
      </div>
      <div className="shop-hero__image"><img src={heroImage} alt="Cordless drill, paint and tools arranged on a light workbench" fetchPriority="high" width="1536" height="1024" /></div>
    </section>
    <section className="shop-container shop-section" id="categories">
      <div className="shop-section__heading"><h2>Shop by category</h2><p>Find the right supplies for the job.</p></div>
      <div className="shop-categories">
        {categories.map((category) => {
          const Icon = categoryIcons[category] || SquaresFour;
          return <Link className="shop-category" to={`/products?category=${encodeURIComponent(category)}`} key={category}>
            <span className="shop-category__image"><Icon size={31} weight="duotone" aria-hidden="true" /></span>
            <strong>{category}</strong><ArrowRight size={17} className="shop-category__arrow" aria-hidden="true" />
          </Link>;
        })}
        {!categories.length && <div className="shop-categories__status" role={error ? "alert" : "status"}>
          <p>{loading ? "Loading categories…" : error ? "Categories could not load." : "Categories will appear when products are available."}</p>
          {error && <button className="shop-text-button" type="button" onClick={onRetry}>Try again</button>}
        </div>}
      </div>
    </section>
    <section className="shop-container shop-scan-feature" aria-labelledby="shop-scan-title">
      <div className="shop-scan-feature__image"><img src={scanSpaceImage} alt="A bright living room with natural finishes" loading="lazy" width="1536" height="1024" /></div>
      <div className="shop-scan-feature__copy"><span className="shop-scan-feature__eyebrow">ScanSpace</span>
        <h2 id="shop-scan-title">See your space before you build.</h2><p>Try finishes and plan materials in your room.</p>
        <Link className="shop-text-button" to="/scanspace">Explore ScanSpace <ArrowRight size={18} aria-hidden="true" /></Link>
      </div>
    </section>
    <section className="shop-container shop-pickup" id="pickup">
      <div className="shop-pickup__intro"><MapPin size={26} aria-hidden="true" /><h2>Easy branch pickup</h2><p>Get your supplies in a few simple steps.</p></div>
      <ol>
        <li><b>1</b><span><strong>Shop supplies</strong><small>Find the items you need.</small></span></li>
        <li><b>2</b><span><strong>Review your cart</strong><small>Keep a saved draft of your items.</small></span></li>
        <li><b>3</b><span><strong>Confirm pickup</strong><small>Check stock and price with your branch.</small></span></li>
      </ol>
      <button className="shop-button shop-button--outline" type="button" onClick={showCart}>View cart <ArrowRight size={18} aria-hidden="true" /></button>
    </section>
  </main>;
}
