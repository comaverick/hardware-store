import { Layout } from "antd";
import { useState } from "react";

import Sidebar from "../Sidebar/Sidebar";
import Topbar from "../Topbar/Topbar";
import Assistant from "../../../pages/Assistant/Assistant";

import "./AppLayout.css";

const AppLayout = ({ children }) => {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  return (
    <Layout className="app-layout">
      <Sidebar expanded={sidebarExpanded} setExpanded={setSidebarExpanded} />

      <Topbar sidebarExpanded={sidebarExpanded} />

      <main
        className={`app-content ${
          sidebarExpanded ? "app-content-expanded" : "app-content-collapsed"
        }`}
      >
        {children}
      </main>
      <Assistant />
    </Layout>
  );
};

export default AppLayout;
