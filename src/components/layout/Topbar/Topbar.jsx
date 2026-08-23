import {
  DownOutlined,
  EnvironmentOutlined,
  CheckOutlined,
  CloseOutlined,
  LogoutOutlined,
  MenuOutlined,
  UserOutlined,
  SettingOutlined,
} from "@ant-design/icons";

import { Avatar, Dropdown } from "antd";

import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

import { useAuth } from "../../../context/AuthContext";
import api from "../../../services/api";

import "./Topbar.css";

const Topbar = ({
  sidebarExpanded,
  mobileOpen = false,
  onMenuClick = () => {},
  branchOptions = [],
  selectedBranch = "ALL",
  onBranchChange = () => {},
}) => {
  const { user, logout } = useAuth();

  const location = useLocation();

  const navigate = useNavigate();
  const [systemStatus, setSystemStatus] = useState("checking");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  useEffect(() => {
    let active = true;

    const checkSystemStatus = async () => {
      try {
        await api.get("/health");
        if (active) setSystemStatus("online");
      } catch {
        if (active) setSystemStatus("offline");
      }
    };

    checkSystemStatus();
    const interval = window.setInterval(checkSystemStatus, 30000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setBranchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!branchOpen) return undefined;

    const closeBranchMenu = (event) => {
      if (event.key === "Escape" || !event.target?.closest?.(".topbar-branch-picker")) {
        setBranchOpen(false);
      }
    };

    document.addEventListener("keydown", closeBranchMenu);
    document.addEventListener("pointerdown", closeBranchMenu);

    return () => {
      document.removeEventListener("keydown", closeBranchMenu);
      document.removeEventListener("pointerdown", closeBranchMenu);
    };
  }, [branchOpen]);

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

    "/purchases": {
      title: "Purchases",
      description: "Track purchased inventory",
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
    "/purchases": "Purchasing",
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

  const selectedBranchOption = branchOptions.find(
    (branch) => String(branch.id) === String(selectedBranch),
  );
  const branchName = selectedBranchOption?.name || "All branches";
  const branchCode = selectedBranchOption?.code || (selectedBranch === "ALL" ? "All branches" : "Branch");

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
        <button
          type="button"
          className="topbar-mobile-menu"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-controls="primary-navigation"
          aria-expanded={mobileOpen}
          onClick={onMenuClick}
        >
          {mobileOpen ? <CloseOutlined /> : <MenuOutlined />}
        </button>

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
        {/* BRANCH */}

        <div className={`topbar-branch-picker ${branchOpen ? "open" : ""}`}>
          <button
            type="button"
            className="topbar-branch"
            aria-haspopup="listbox"
            aria-controls="topbar-branch-options"
            aria-expanded={branchOpen}
            aria-label={`Select branch, currently ${branchName}`}
            onClick={() => setBranchOpen((open) => !open)}
          >
            <span className="branch-icon">
              <EnvironmentOutlined />
            </span>

            <span className="topbar-branch-info">
              <span className="branch-label">Branch scope</span>

              <span className="branch-value">{branchCode}</span>
            </span>

            <DownOutlined className="branch-arrow" />
          </button>

          {branchOpen && (
            <div id="topbar-branch-options" className="topbar-branch-menu" role="listbox" aria-label="Branch scope options">
              <div className="topbar-branch-menu-title">Branch scope</div>

              <button
                type="button"
                role="option"
                aria-selected={selectedBranch === "ALL"}
                className={`topbar-branch-option ${selectedBranch === "ALL" ? "selected" : ""}`}
                onClick={() => {
                  onBranchChange("ALL");
                  setBranchOpen(false);
                }}
              >
                <span className="topbar-branch-option-icon"><EnvironmentOutlined /></span>
                <span>
                  <strong>All branches</strong>
                  <small>View every store</small>
                </span>
                {selectedBranch === "ALL" && <CheckOutlined />}
              </button>

              {branchOptions.map((branch) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={String(selectedBranch) === String(branch.id)}
                  className={`topbar-branch-option ${String(selectedBranch) === String(branch.id) ? "selected" : ""}`}
                  key={branch.id}
                  onClick={() => {
                    onBranchChange(branch.id);
                    setBranchOpen(false);
                  }}
                >
                  <span className="topbar-branch-option-icon"><EnvironmentOutlined /></span>
                  <span>
                    <strong>{branch.name}</strong>
                    <small>{branch.code || "Branch"}</small>
                  </span>
                  {String(selectedBranch) === String(branch.id) && <CheckOutlined />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`topbar-system-status topbar-system-status-${systemStatus}`} title="API and database connection status">
          <span className="topbar-system-dot" />
          <span>{systemStatus === "online" ? "System online" : systemStatus === "offline" ? "System offline" : "Checking system"}</span>
        </div>

        {/* USER */}

        <Dropdown
          menu={{
            items: menuItems,
            onClick: handleMenuClick,
          }}
          trigger={["click"]}
          placement="bottomRight"
          overlayClassName="topbar-user-menu"
          getPopupContainer={(triggerNode) => triggerNode.closest(".topbar") || document.body}
          open={userMenuOpen}
          onOpenChange={setUserMenuOpen}
        >
          <button
            type="button"
            className={`topbar-user ${userMenuOpen ? "topbar-user-open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
          >
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
