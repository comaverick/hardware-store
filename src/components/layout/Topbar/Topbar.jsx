import {
  BellOutlined,
  DownOutlined,
  EnvironmentOutlined,
  LogoutOutlined,
  UserOutlined,
  SettingOutlined,
} from "@ant-design/icons";

import { Avatar, Badge, Dropdown } from "antd";

import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../../context/AuthContext";

import "./Topbar.css";

const Topbar = ({ sidebarExpanded }) => {
  const { user, logout } = useAuth();

  const location = useLocation();

  const navigate = useNavigate();

  const pageTitles = {
    "/dashboard": {
      title: "Dashboard",
      description: "Overview of your store",
    },

    "/pos": {
      title: "Point of Sale",
      description: "Process customer transactions",
    },

    "/products": {
      title: "Products",
      description: "Manage your product catalog",
    },

    "/inventory": {
      title: "Inventory",
      description: "Monitor your stock levels",
    },

    "/reservations": {
      title: "Reservations",
      description: "Manage product holds for pickup",
    },
    "/product-finder": {
      title: "AI Product Finder",
      description: "Find products with guided scanning",
    },
    "/user-management": {
      title: "User Management",
      description: "Manage users and permissions",
    },

    "/audit-logs": {
      title: "Audit Logs",
      description: "Review system activity",
    },

    "/stock-history": {
      title: "Stock History",
      description: "Track inventory movements",
    },

    "/transfers": {
      title: "Stock Transfers",
      description: "Move inventory between branches",
    },

    "/suppliers": {
      title: "Suppliers",
      description: "Manage your suppliers",
    },

    "/purchase-orders": {
      title: "Purchase Orders",
      description: "Manage supplier orders",
    },

    "/purchases": {
      title: "Purchases",
      description: "Track purchased inventory",
    },

    "/customers": {
      title: "Customers",
      description: "Manage customer information",
    },

    "/reports": {
      title: "Reports",
      description: "View store performance",
    },

    "/settings": {
      title: "Settings",
      description: "Manage system settings",
    },
  };

  const pageCategories = {
    "/dashboard": "Store",
    "/pos": "Store",
    "/products": "Catalog",
    "/inventory": "Inventory",
    "/reservations": "Inventory",
    "/product-finder": "Inventory",
    "/stock-history": "Inventory",
    "/transfers": "Inventory",
    "/suppliers": "Purchasing",
    "/purchase-orders": "Purchasing",
    "/purchases": "Purchasing",
    "/customers": "Management",
    "/reports": "Management",
    "/settings": "System",
    "/user-management": "Administration",
    "/audit-logs": "Administration",
  };
  const currentPage = {
    ...(pageTitles[location.pathname] || {
      title: "Hardware Store",
      description: "Store management system",
    }),
    category: pageCategories[location.pathname] || "Store",
  };

  const menuItems = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: "My Profile",
    },

    {
      key: "settings",
      icon: <SettingOutlined />,
      label: "Settings",
    },

    {
      type: "divider",
    },

    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "Sign Out",
      danger: true,
    },
  ];

  const handleMenuClick = ({ key }) => {
    if (key === "logout") {
      logout();

      window.location.href = "/login";

      return;
    }

    if (key === "settings") {
      navigate("/settings");
    }
  };

  const branchCode = user?.branch?.code || "ALL BRANCHES";

  return (
    <header
      className={`topbar ${
        sidebarExpanded ? "topbar-expanded" : "topbar-collapsed"
      }`}
    >
      {/* =================================
          LEFT
      ================================= */}

      <div className="topbar-left">
        <div className="page-heading">
          <span className="breadcrumb-category">{currentPage.category}</span>
          <span className="breadcrumb-separator" aria-hidden="true">&gt;</span>
          <h1 className="page-title">{currentPage.title}</h1>
        </div>
      </div>

      {/* =================================
          RIGHT
      ================================= */}

      <div className="topbar-right">
        {/* NOTIFICATIONS */}

        <button
          type="button"
          className="topbar-icon-button"
          aria-label="Notifications"
        >
          <Badge dot offset={[-2, 2]}>
            <BellOutlined />
          </Badge>
        </button>

        {/* BRANCH */}

        <div className="topbar-branch">
          <div className="branch-icon">
            <EnvironmentOutlined />
          </div>

          <div className="branch-info">
            <span className="branch-label">Current Branch</span>

            <span className="branch-value">{branchCode}</span>
          </div>

          <DownOutlined className="branch-arrow" />
        </div>

        {/* DIVIDER */}

        <div className="topbar-divider" />

        {/* USER */}

        <Dropdown
          menu={{
            items: menuItems,
            onClick: handleMenuClick,
          }}
          trigger={["click"]}
          placement="bottomRight"
        >
          <button type="button" className="topbar-user">
            <Avatar className="topbar-avatar" icon={<UserOutlined />} />

            <div className="topbar-user-info">
              <span className="topbar-user-name">
                {user?.name || "Administrator"}
              </span>

              <span className="topbar-user-role">
                {user?.role || "Store Manager"}
              </span>
            </div>

            <DownOutlined className="topbar-user-arrow" />
          </button>
        </Dropdown>
      </div>
    </header>
  );
};

export default Topbar;
