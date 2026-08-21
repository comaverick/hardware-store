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
  ShopOutlined,
  FileTextOutlined,
  LockOutlined,
  CameraOutlined,
  AuditOutlined,
} from "@ant-design/icons";

import { Tooltip } from "antd";

import { useLocation, useNavigate } from "react-router-dom";

import { useRef } from "react";
import { useAuth } from "../../../context/AuthContext";

import "./Sidebar.css";

const Sidebar = ({ expanded, setExpanded }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const collapseTimer = useRef(null);

  // ========================================
  // HOVER
  // ========================================

  const handleMouseEnter = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
    }

    setExpanded(true);
  };

  const handleMouseLeave = () => {
    collapseTimer.current = setTimeout(() => {
      setExpanded(false);
    }, 300);
  };

  // ========================================
  // MENU GROUPS
  // ========================================

  const menuGroups = [
    {
      title: "Store",

      items: [
        {
          key: "/dashboard",
          icon: <DashboardOutlined />,
          label: "Dashboard",
        },
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
        {
          key: "/transfers",
          icon: <SwapOutlined />,
          label: "Stock Transfers",
        },
      ],
    },

    {
      title: "Purchasing",

      items: [
        {
          key: "/suppliers",
          icon: <ShopOutlined />,
          label: "Suppliers",
        },
        {
          key: "/purchase-orders",
          icon: <FileTextOutlined />,
          label: "Purchase Orders",
        },
        {
          key: "/purchases",
          icon: <ShoppingOutlined />,
          label: "Purchases",
        },
      ],
    },

    {
      title: "Management",

      items: [
        {
          key: "/customers",
          icon: <TeamOutlined />,
          label: "Customers",
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
        onClick={() => navigate(item.key)}
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
      className={`sidebar ${
        expanded ? "sidebar-expanded" : "sidebar-collapsed"
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* =================================
          BRAND
      ================================= */}

      <div className="sidebar-brand">
        <div className="sidebar-logo">H</div>

        <div className="sidebar-brand-text">
          <div className="sidebar-title">Hardware Store</div>

          <div className="sidebar-subtitle">Management System</div>
        </div>
      </div>

      {/* =================================
          NAVIGATION
      ================================= */}

      <nav className="sidebar-navigation">
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
