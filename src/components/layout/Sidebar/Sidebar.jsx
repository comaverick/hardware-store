import {
  DashboardOutlined,
  ShoppingCartOutlined,
  AppstoreOutlined,
  InboxOutlined,
  SwapOutlined,
  ShoppingOutlined,
  TeamOutlined,
  BarChartOutlined,
  SettingOutlined,
  HistoryOutlined,
  LockOutlined,
  CameraOutlined,
  AuditOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CloseOutlined,
} from "@ant-design/icons";

import { Tooltip } from "antd";

import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "../../../context/AuthContext";

import "./Sidebar.css";

const Sidebar = ({
  expanded,
  setExpanded,
  mobileOpen = false,
  setMobileOpen = () => {},
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const hoverTimer = useRef(null);
  const mobileCloseRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [navigationPinned, setNavigationPinned] = useState(false);

  const clearHoverTimer = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const isMobileViewport = () => window.matchMedia("(max-width: 900px)").matches;

  const handleMouseEnter = () => {
    if (navigationPinned || mobileOpen || isMobileViewport()) return;

    clearHoverTimer();
    setExpanded(true);
  };

  const handleMouseLeave = () => {
    if (navigationPinned || mobileOpen || isMobileViewport()) return;

    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      setExpanded(false);
    }, 180);
  };

  const handleToggle = () => {
    clearHoverTimer();

    if (mobileOpen) {
      setMobileOpen(false);
      return;
    }

    const nextValue = !expanded;
    setNavigationPinned(nextValue);
    setExpanded(nextValue);
  };

  useEffect(() => () => clearHoverTimer(), []);

  useEffect(() => {
    if (mobileOpen) {
      previousFocusRef.current = document.activeElement;
      const focusFrame = window.requestAnimationFrame(() => mobileCloseRef.current?.focus());
      return () => window.cancelAnimationFrame(focusFrame);
    }

    if (previousFocusRef.current instanceof HTMLElement && document.contains(previousFocusRef.current)) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }

    return undefined;
  }, [mobileOpen]);

  // ========================================
  // MENU GROUPS
  // ========================================

  const menuGroups = [
    {
      title: "Overview",

      items: [
        {
          key: "/dashboard",
          icon: <DashboardOutlined />,
          label: "Dashboard",
        },
      ],
    },

    {
      title: "Operations",

      items: [
        {
          key: "/pos",
          icon: <ShoppingCartOutlined />,
          label: "Point of Sale",
        },
        {
          key: "/products",
          icon: <AppstoreOutlined />,
          label: "Products",
        },
      ],
    },

    {
      title: "Inventory",

      items: [
        {
          key: "/inventory",
          icon: <InboxOutlined />,
          label: "Inventory",
        },
        {
          key: "/stock-history",
          icon: <HistoryOutlined />,
          label: "Stock History",
        },
        {
          key: "/reservations",
          icon: <LockOutlined />,
          label: "Reservations",
        },
        {
          key: "/product-finder",
          icon: <CameraOutlined />,
          label: "AI Product Finder",
        },
      ],
    },

    {
      title: "Management",

      items: [
        {
          key: "/purchases",
          icon: <ShoppingOutlined />,
          label: "Purchases",
        },
        {
          key: "/transfers",
          icon: <SwapOutlined />,
          label: "Stock transfers",
        },
        {
          key: "/reports",
          icon: <BarChartOutlined />,
          label: "Reports",
        },
        ...(["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user?.role)
          ? [
              {
                key: "/audit-logs",
                icon: <AuditOutlined />,
                label: "Audit Logs",
              },
            ]
          : []),
        ...(["SUPER_ADMIN"].includes(user?.role)
          ? [
              {
                key: "/user-management",
                icon: <TeamOutlined />,
                label: "User Management",
              },
            ]
          : []),
      ],
    },
  ];

  // ========================================
  // BOTTOM
  // ========================================

  const bottomItems = [
    {
      key: "/settings",
      icon: <SettingOutlined />,
      label: "Settings",
    },
  ];

  // ========================================
  // MENU ITEM
  // ========================================

  const renderMenuItem = (item) => {
    const isActive = location.pathname === item.key;

    const button = (
      <button
        type="button"
        className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
        onClick={() => {
          navigate(item.key);
          setMobileOpen(false);
        }}
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
      >
        <span className="sidebar-item-icon">{item.icon}</span>

        <span className="sidebar-item-label">{item.label}</span>
      </button>
    );

    if (!expanded) {
      return (
        <Tooltip
          key={item.key}
          title={item.label}
          placement="right"
          mouseEnterDelay={0.25}
        >
          {button}
        </Tooltip>
      );
    }

    return <div key={item.key}>{button}</div>;
  };

  return (
    <aside
      className={`sidebar ${expanded ? "sidebar-expanded" : "sidebar-collapsed"} ${
        mobileOpen ? "sidebar-mobile-open" : ""
      }`}
      id="primary-navigation"
      aria-label="Hardware Management System navigation"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* =================================
          BRAND
      ================================= */}

      <div className="sidebar-brand">
        <button
          type="button"
          className="sidebar-brand-toggle"
          aria-label={mobileOpen ? "Close navigation" : expanded ? "Collapse navigation" : "Expand navigation"}
          aria-expanded={mobileOpen ? true : expanded}
          onClick={handleToggle}
        >
          <svg
            className="sidebar-logo"
            viewBox="0 0 40 40"
            role="img"
            aria-label="Hardware Management System"
          >
            <rect x="6" y="6" width="28" height="28" rx="7" />
            <path d="M13 14h14M13 20h8M13 26h14M24 17v6M28 17v6" />
            <circle cx="24" cy="14" r="1.5" />
            <circle cx="28" cy="26" r="1.5" />
          </svg>
        </button>

        <div className="sidebar-brand-text">
          <div className="sidebar-title">Hardware Ops</div>

          <div className="sidebar-subtitle">Management system</div>
        </div>

        <button
          type="button"
          className="sidebar-collapse-button"
          ref={mobileCloseRef}
          aria-label={mobileOpen ? "Close navigation" : expanded ? "Collapse navigation" : "Expand navigation"}
          aria-expanded={mobileOpen ? true : expanded}
          onClick={handleToggle}
        >
          {mobileOpen ? <CloseOutlined /> : expanded ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
        </button>
      </div>

      {/* =================================
          NAVIGATION
      ================================= */}

      <nav className="sidebar-navigation" aria-label="Primary navigation">
        {menuGroups.map((group) => (
          <div className="sidebar-group" key={group.title}>
            <div className="sidebar-group-title">{group.title}</div>

            <div className="sidebar-group-items">
              {group.items.map((item) => renderMenuItem(item))}
            </div>
          </div>
        ))}
      </nav>

      {/* =================================
          BOTTOM
      ================================= */}

      <div className="sidebar-bottom">
        {bottomItems.map((item) => renderMenuItem(item))}
      </div>
    </aside>
  );
};

export default Sidebar;
