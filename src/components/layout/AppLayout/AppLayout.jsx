import { Layout } from "antd";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";

import Sidebar from "../Sidebar/Sidebar";
import Topbar from "../Topbar/Topbar";
import Assistant from "../../../pages/Assistant/Assistant";

import "./AppLayout.css";

const AppLayout = ({ children }) => {
  const location = useLocation();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [branchOptions, setBranchOptions] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("ALL");
  const [sidebarTransitioning, setSidebarTransitioning] = useState(false);
  const previousSidebarExpanded = useRef(sidebarExpanded);
  const sidebarMotionTimer = useRef(null);

  useLayoutEffect(() => {
    if (previousSidebarExpanded.current === sidebarExpanded) return undefined;

    previousSidebarExpanded.current = sidebarExpanded;
    setSidebarTransitioning(true);

    sidebarMotionTimer.current = window.setTimeout(() => {
      setSidebarTransitioning(false);
      sidebarMotionTimer.current = null;
    }, 230);

    return () => {
      if (sidebarMotionTimer.current) {
        window.clearTimeout(sidebarMotionTimer.current);
        sidebarMotionTimer.current = null;
      }
    };
  }, [sidebarExpanded]);

  useEffect(() => {
    if (!mobileSidebarOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileSidebarOpen]);

  const branchScope = {
    options: branchOptions,
    selectedBranch,
  };

  const content = isValidElement(children)
    ? cloneElement(children, {
      branchScope,
      onBranchOptionsChange: setBranchOptions,
    })
    : children;

  return (
    <Layout
      className={`app-layout ${location.pathname === "/pos" ? "app-layout-pos" : ""} ${
        sidebarTransitioning ? "app-layout-sidebar-moving" : ""
      }`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <Sidebar
        expanded={sidebarExpanded}
        setExpanded={setSidebarExpanded}
        mobileOpen={mobileSidebarOpen}
        setMobileOpen={setMobileSidebarOpen}
      />

      <Topbar
        sidebarExpanded={sidebarExpanded}
        mobileOpen={mobileSidebarOpen}
        onMenuClick={() => setMobileSidebarOpen((open) => !open)}
        branchOptions={branchOptions}
        selectedBranch={selectedBranch}
        onBranchChange={setSelectedBranch}
      />

      <button
        type="button"
        className={`app-sidebar-scrim ${mobileSidebarOpen ? "app-sidebar-scrim-open" : ""}`}
        aria-label="Close navigation"
        aria-hidden={!mobileSidebarOpen}
        tabIndex={mobileSidebarOpen ? 0 : -1}
        onClick={() => setMobileSidebarOpen(false)}
      />

      <main
        id="main-content"
        className={`app-content ${
          sidebarExpanded ? "app-content-expanded" : "app-content-collapsed"
        }`}
      >
        {content}
      </main>
      <Assistant />
    </Layout>
  );
};

export default AppLayout;
