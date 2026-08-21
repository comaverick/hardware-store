import { useEffect, useMemo, useState } from "react";

import {
  ArrowDownOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  DownOutlined,
} from "@ant-design/icons";

import { Alert, Card, Col, Row, Skeleton, Spin, Typography } from "antd";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";

import "./Dashboard.css";

const { Title, Text } = Typography;

const localDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isCompletedSale = (sale) => {
  const status = String(sale?.status || "COMPLETED").toUpperCase();
  return status === "COMPLETED";
};

const getSaleDate = (sale) => {
  const timestamp = sale?.createdAt || sale?.date || sale?.updatedAt;
  const parsedDate = new Date(timestamp);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const Dashboard = () => {
  const { user } = useAuth();
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";
  const [inventory, setInventory] = useState([]);
  const [sales, setSales] = useState([]);
  const [smartData, setSmartData] = useState(null);

  const [loading, setLoading] = useState(true);
  const [smartLoading, setSmartLoading] = useState(true);

  const [error, setError] = useState(null);

  const [selectedBranch, setSelectedBranch] = useState("ALL");

  const [branchOpen, setBranchOpen] = useState(false);

  const [salesPeriod, setSalesPeriod] = useState("WEEK");

  // ========================================
  // FETCH DASHBOARD
  // ========================================

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        setLoading(true);
        setError(null);

        const [inventoryResponse, salesResponse] = await Promise.all([
          api.get("/inventory"),
          api.get("/sales"),
        ]);

        setInventory(inventoryResponse.data || []);

        setSales(salesResponse.data || []);
      } catch (error) {
        console.error("Dashboard error:", error);

        setError(
          error.response?.data?.message || "Failed to load dashboard data.",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, []);

  // ========================================
  // BRANCHES
  // ========================================

  const availableBranches = useMemo(() => {
    const branchMap = new Map();

    inventory.forEach((item) => {
      if (!item.branch?._id) return;

      if (!branchMap.has(item.branch._id)) {
        branchMap.set(item.branch._id, {
          id: item.branch._id,
          name: item.branch.name,
          code: item.branch.code,
        });
      }
    });

    return Array.from(branchMap.values());
  }, [inventory]);

  const selectedBranchName = useMemo(() => {
    if (selectedBranch === "ALL") {
      return "All Branches";
    }

    return (
      availableBranches.find((branch) => branch.id === selectedBranch)?.name ||
      "All Branches"
    );
  }, [selectedBranch, availableBranches]);

  // ========================================
  // FILTER INVENTORY
  // ========================================

  const filteredInventory = useMemo(() => {
    if (selectedBranch === "ALL") {
      return inventory;
    }

    return inventory.filter(
      (item) => String(item.branch?._id) === String(selectedBranch),
    );
  }, [inventory, selectedBranch]);

  // ========================================
  // FILTER SALES
  // ========================================

  const filteredSales = useMemo(() => {
    if (selectedBranch === "ALL") {
      return sales;
    }

    return sales.filter(
      (sale) => String(sale.branch?._id) === String(selectedBranch),
    );
  }, [sales, selectedBranch]);

  // ========================================
  // INVENTORY
  // ========================================

  const totalStock = filteredInventory.reduce(
    (total, item) => total + Number(item.quantity || 0),
    0,
  );

  const lowStockItems = filteredInventory.filter(
    (item) => Number(item.quantity) <= Number(item.reorderLevel),
  );

  // ========================================
  // TODAY
  // ========================================

  const todayStart = new Date();

  todayStart.setHours(0, 0, 0, 0);

  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const todaySales = filteredSales.filter((sale) => {
    if (!isCompletedSale(sale)) {
      return false;
    }

    const saleDate = getSaleDate(sale);

    return saleDate && saleDate >= todayStart && saleDate < tomorrowStart;
  });

  const todaySalesAmount = todaySales.reduce(
    (total, sale) => total + Number(sale.totalAmount || 0),
    0,
  );

  const todayTransactions = todaySales.length;

  // ========================================
  // SALES CHART
  // ========================================

  const salesPeriodData = useMemo(() => {
    const now = new Date();

    if (salesPeriod === "TODAY") {
      const startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);

      return Array.from({ length: 24 }, (_, hour) => {
        const bucketStart = new Date(startDate);
        bucketStart.setHours(hour, 0, 0, 0);
        const bucketEnd = new Date(bucketStart);
        bucketEnd.setHours(hour + 1, 0, 0, 0);

        const hourSales = filteredSales.filter((sale) => {
          if (!isCompletedSale(sale)) return false;
          const saleDate = getSaleDate(sale);
          return saleDate && saleDate >= bucketStart && saleDate < bucketEnd;
        });

        return {
          date: bucketStart.toISOString(),
          label: bucketStart.toLocaleTimeString("en-US", {
            hour: "numeric",
          }),
          sales: hourSales.reduce(
            (total, sale) => total + Number(sale.totalAmount || 0),
            0,
          ),
          transactions: hourSales.length,
        };
      });
    }

    let startDate;
    let numberOfDays;

    if (salesPeriod === "MONTH") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      numberOfDays = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
      ).getDate();
    } else {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
      numberOfDays = 7;
    }

    return Array.from({ length: numberOfDays }, (_, i) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const dateKey = localDateKey(date);

      const daySales = filteredSales.filter((sale) => {
        if (!isCompletedSale(sale)) return false;
        const saleDate = getSaleDate(sale);
        return saleDate && localDateKey(saleDate) === dateKey;
      });

      return {
        date: dateKey,
        label: salesPeriod === "MONTH"
          ? date.getDate()
          : date.toLocaleDateString("en-US", { weekday: "short" }),
        sales: daySales.reduce(
          (total, sale) => total + Number(sale.totalAmount || 0),
          0,
        ),
        transactions: daySales.length,
      };
    });
  }, [filteredSales, salesPeriod]);
  const salesChartData = salesPeriodData.map((bucket) => {
    const bucketStart = salesPeriod === "TODAY"
      ? new Date(bucket.date)
      : new Date(`${bucket.date}T00:00:00`);
    const previousStart = new Date(bucketStart);

    if (salesPeriod === "TODAY") {
      previousStart.setDate(previousStart.getDate() - 1);
    } else if (salesPeriod === "WEEK") {
      previousStart.setDate(previousStart.getDate() - 7);
    } else {
      previousStart.setMonth(previousStart.getMonth() - 1);
    }

    const previousEnd = new Date(previousStart);
    if (salesPeriod === "TODAY") {
      previousEnd.setHours(previousEnd.getHours() + 1);
    } else {
      previousEnd.setDate(previousEnd.getDate() + 1);
    }

    const previousSales = filteredSales.filter((sale) => {
      if (!isCompletedSale(sale)) return false;
      const saleDate = getSaleDate(sale);
      return saleDate && saleDate >= previousStart && saleDate < previousEnd;
    });

    return {
      ...bucket,
      previousSales: previousSales.reduce(
        (total, sale) => total + Number(sale.totalAmount || 0),
        0,
      ),
    };
  });

  const periodSalesTotal = salesPeriodData.reduce(
    (total, day) => total + day.sales,
    0,
  );

  const periodTransactions = salesPeriodData.reduce(
    (total, day) => total + day.transactions,
    0,
  );
  const periodComparison = useMemo(() => {
    const now = new Date();
    let previousStart;
    let previousEnd;
    let comparisonLabel;

    if (salesPeriod === "TODAY") {
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      previousEnd = todayStart;
      previousStart = new Date(todayStart);
      previousStart.setDate(previousStart.getDate() - 1);
      comparisonLabel = "vs yesterday";
    } else if (salesPeriod === "WEEK") {
      const weekStart = new Date(now);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - 6);
      previousEnd = new Date(weekStart);
      previousStart = new Date(weekStart);
      previousStart.setDate(previousStart.getDate() - 7);
      comparisonLabel = "vs last week";
    } else {
      previousEnd = new Date(now.getFullYear(), now.getMonth(), 1);
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      comparisonLabel = "vs last month";
    }

    const previousSales = filteredSales.filter((sale) => {
      if (!isCompletedSale(sale)) return false;
      const saleDate = getSaleDate(sale);
      return saleDate && saleDate >= previousStart && saleDate < previousEnd;
    });
    const previousTotal = previousSales.reduce(
      (total, sale) => total + Number(sale.totalAmount || 0),
      0,
    );
    const salesChange = previousTotal
      ? ((periodSalesTotal - previousTotal) / previousTotal) * 100
      : periodSalesTotal > 0 ? 100 : 0;
    const transactionChange = previousSales.length
      ? ((periodTransactions - previousSales.length) / previousSales.length) * 100
      : periodTransactions > 0 ? 100 : 0;

    return { comparisonLabel, salesChange, transactionChange };
  }, [filteredSales, periodSalesTotal, periodTransactions, salesPeriod]);

  // ========================================
  // BRANCH OVERVIEW
  // ========================================

  const branchStock = filteredInventory.reduce((branches, item) => {
    const branchId = item.branch?._id;

    if (!branchId) {
      return branches;
    }

    if (!branches[branchId]) {
      branches[branchId] = {
        id: branchId,

        name: item.branch.name,

        code: item.branch.code,

        stock: 0,

        lowStock: 0,
      };
    }

    branches[branchId].stock += Number(item.quantity || 0);

    if (Number(item.quantity) <= Number(item.reorderLevel)) {
      branches[branchId].lowStock += 1;
    }

    return branches;
  }, {});

  const branches = Object.values(branchStock);

  // ========================================
  // SMART INVENTORY
  // ========================================

  useEffect(() => {
    const fetchSmartInventory = async () => {
      if (inventory.length === 0) {
        setSmartData(null);
        setSmartLoading(false);
        return;
      }

      try {
        setSmartLoading(true);

        const branchIds =
          selectedBranch === "ALL"
            ? [
                ...new Set(
                  inventory.map((item) => item.branch?._id).filter(Boolean),
                ),
              ]
            : [selectedBranch];

        if (branchIds.length === 0) {
          setSmartData(null);
          setSmartLoading(false);
          return;
        }

        const responses = await Promise.all(
          branchIds.map((branchId) => api.get(`/smart-inventory/${branchId}`)),
        );

        const combined = responses.flatMap(
          (response) => response.data?.recommendations || [],
        );

        const criticalCount = combined.filter(
          (item) => item.risk === "CRITICAL",
        ).length;

        const highCount = combined.filter(
          (item) => item.risk === "HIGH",
        ).length;

        const mediumCount = combined.filter(
          (item) => item.risk === "MEDIUM",
        ).length;

        const priority = {
          CRITICAL: 1,
          HIGH: 2,
          MEDIUM: 3,
          LOW: 4,
        };

        combined.sort(
          (a, b) => (priority[a.risk] || 5) - (priority[b.risk] || 5),
        );

        setSmartData({
          recommendations: combined,

          criticalCount,

          highCount,

          mediumCount,
        });
      } catch (error) {
        console.error("Smart inventory error:", error);

        setSmartData(null);
      } finally {
        setSmartLoading(false);
      }
    };

    fetchSmartInventory();
  }, [inventory, selectedBranch]);

  // ========================================
  // SMART HELPERS
  // ========================================

  const getRiskClass = (risk) => {
    if (risk === "CRITICAL") {
      return "risk-critical";
    }

    if (risk === "HIGH") {
      return "risk-high";
    }

    if (risk === "MEDIUM") {
      return "risk-medium";
    }

    return "risk-low";
  };

  const getRiskIcon = (risk) => {
    if (risk === "CRITICAL") {
      return <ExclamationCircleOutlined />;
    }

    if (risk === "HIGH" || risk === "MEDIUM") {
      return <WarningOutlined />;
    }

    return <CheckCircleOutlined />;
  };

  const smartRecommendations =
    smartData?.recommendations
      ?.filter((item) => item.risk !== "LOW" || item.recommendedOrder > 0)
      .slice(0, 4) || [];

  // ========================================
  // RECENT SALES
  // ========================================

  const recentSales = filteredSales
    .filter((sale) => isCompletedSale(sale))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  // ========================================
  // LOADING
  // ========================================

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="dashboard-loading-heading">
          <Skeleton.Input active size="large" />
          <Skeleton.Input active size="small" />
        </div>
        <Row gutter={[16, 16]} className="dashboard-loading-kpis">
          {[1, 2, 3, 4].map((item) => (
            <Col xs={24} sm={12} lg={6} key={item}>
              <Card className="dashboard-skeleton-card">
                <Skeleton active paragraph={{ rows: 2 }} title={{ width: "55%" }} />
              </Card>
            </Col>
          ))}
        </Row>
        <Row gutter={[16, 16]} className="dashboard-loading-main">
          <Col xs={24} lg={16}>
            <Card className="dashboard-skeleton-card">
              <Skeleton active paragraph={{ rows: 7 }} title={{ width: "35%" }} />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card className="dashboard-skeleton-card">
              <Skeleton active paragraph={{ rows: 7 }} title={{ width: "45%" }} />
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  // ========================================
  // ERROR
  // ========================================

  if (error) {
    return (
      <div className="dashboard-error">
        <Alert
          message="Dashboard Error"
          description={error}
          type="error"
          showIcon
        />
      </div>
    );
  }

  // ========================================
  // UI
  // ========================================

  return (
    <div className="dashboard">
      {/* ==================================
          HEADER
      ================================== */}

      <section className="dashboard-header">
        <div className="dashboard-heading">

          <Title level={1}>{greeting}, {user?.name || "there"}</Title>

          <Text className="dashboard-subtitle">
            Here's what's happening across your store today.
          </Text>
        </div>

        {/* BRANCH SELECTOR */}

        <div className="branch-picker">
          <button
            type="button"
            className={`branch-picker-button ${branchOpen ? "open" : ""}`}
            onClick={() => setBranchOpen(!branchOpen)}
          >
            <div className="branch-picker-icon">
              <ShopOutlined />
            </div>

            <div className="branch-picker-text">
              <span>CURRENT BRANCH</span>

              <strong>{selectedBranchName}</strong>
            </div>

            <DownOutlined />
          </button>

          {branchOpen && (
            <div className="branch-picker-menu">
              <div className="branch-picker-title">SELECT BRANCH</div>

              <button
                type="button"
                className={`branch-option ${
                  selectedBranch === "ALL" ? "selected" : ""
                }`}
                onClick={() => {
                  setSelectedBranch("ALL");

                  setBranchOpen(false);
                }}
              >
                <span className="branch-option-icon">
                  <ShopOutlined />
                </span>

                <span className="branch-option-content">
                  <strong>All Branches</strong>

                  <small>View all stores</small>
                </span>

                {selectedBranch === "ALL" && (
                  <CheckOutlined className="branch-check" />
                )}
              </button>

              {availableBranches.map((branch) => (
                <button
                  type="button"
                  key={branch.id}
                  className={`branch-option ${
                    selectedBranch === branch.id ? "selected" : ""
                  }`}
                  onClick={() => {
                    setSelectedBranch(branch.id);

                    setBranchOpen(false);
                  }}
                >
                  <span className="branch-option-icon">
                    <ShopOutlined />
                  </span>

                  <span className="branch-option-content">
                    <strong>{branch.name}</strong>

                    <small>{branch.code || "Branch"}</small>
                  </span>

                  {selectedBranch === branch.id && (
                    <CheckOutlined className="branch-check" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ==================================
          KPI CARDS
      ================================== */}

      <section className="dashboard-kpis">
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card className="kpi-card">
              <div className="kpi-top">
                <span className="kpi-label">Today's Sales</span>

                <span className="kpi-icon sales">&#8369;</span>
              </div>

              <div className="kpi-value">
                &#8369;
                {todaySalesAmount.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                })}
              </div>

              <div className="kpi-footer positive">
                <ArrowUpOutlined />
                {todayTransactions} completed
              </div>
            </Card>
          </Col>

          <Col xs={24} sm={12} lg={6}>
            <Card className="kpi-card">
              <div className="kpi-top">
                <span className="kpi-label">Transactions</span>

                <span className="kpi-icon blue">
                  <ShoppingCartOutlined />
                </span>
              </div>

              <div className="kpi-value">{todayTransactions}</div>

              <div className="kpi-footer">Completed today</div>
            </Card>
          </Col>

          <Col xs={24} sm={12} lg={6}>
            <Card className="kpi-card">
              <div className="kpi-top">
                <span className="kpi-label">Total Stock</span>

                <span className="kpi-icon purple">
                  <InboxOutlined />
                </span>
              </div>

              <div className="kpi-value">{totalStock.toLocaleString()}</div>

              <div className="kpi-footer">
                {selectedBranch === "ALL"
                  ? `Across ${branches.length} branches`
                  : "Current branch"}
              </div>
            </Card>
          </Col>

          <Col xs={24} sm={12} lg={6}>
            <Card
              className={`kpi-card ${
                lowStockItems.length > 0 ? "kpi-warning" : ""
              }`}
            >
              <div className="kpi-top">
                <span className="kpi-label">Stock Alerts</span>

                <span className="kpi-icon orange">
                  <WarningOutlined />
                </span>
              </div>

              <div className="kpi-value">{lowStockItems.length}</div>

              <div
                className={`kpi-footer ${
                  lowStockItems.length > 0 ? "negative" : "positive"
                }`}
              >
                {lowStockItems.length > 0 ? (
                  <>
                    <ArrowDownOutlined />
                    Needs attention
                  </>
                ) : (
                  <>
                    <CheckCircleOutlined />
                    Inventory healthy
                  </>
                )}
              </div>
            </Card>
          </Col>
        </Row>
      </section>

      {/* ==================================
          MAIN GRID
      ================================== */}

      <section className="dashboard-main-grid">
        {/* ==================================
            SALES OVERVIEW
        ================================== */}

        <Card className="sales-overview-card">
          <div className="sales-overview-header">
            <div>
              <Text className="section-eyebrow">PERFORMANCE</Text>

              <Title level={3}>Sales Overview</Title>

              <Text className="section-description">
                Your sales performance over time.
              </Text>
            </div>

            <div className="sales-period-selector">
              <button
                type="button"
                className={salesPeriod === "TODAY" ? "active" : ""}
                onClick={() => setSalesPeriod("TODAY")}
              >
                Today
              </button>

              <button
                type="button"
                className={salesPeriod === "WEEK" ? "active" : ""}
                onClick={() => setSalesPeriod("WEEK")}
              >
                Week
              </button>

              <button
                type="button"
                className={salesPeriod === "MONTH" ? "active" : ""}
                onClick={() => setSalesPeriod("MONTH")}
              >
                Month
              </button>
            </div>
          </div>

          <div className="sales-overview-summary">
            <div>
              <span>SALES</span>

              <strong>
                &#8369;
                {periodSalesTotal.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                })}
              </strong>

              <span className={`comparison-note ${periodComparison.salesChange >= 0 ? "\u2191" : "\u2193"}`}>
                {periodComparison.salesChange >= 0 ? "\u2191" : "\u2193"} {Math.abs(periodComparison.salesChange).toFixed(1)}% {periodComparison.comparisonLabel}
              </span>
            </div>

            <div>
              <span>TRANSACTIONS</span>

              <strong>{periodTransactions}</strong>

              <span className={`comparison-note ${periodComparison.transactionChange >= 0 ? "\u2191" : "\u2193"}`}>
                {periodComparison.transactionChange >= 0 ? "\u2191" : "\u2193"} {Math.abs(periodComparison.transactionChange).toFixed(1)}% {periodComparison.comparisonLabel}
              </span>
            </div>
          </div>

          <div className="sales-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={salesChartData}
                barGap={-28}
                margin={{
                  top: 10,
                  right: 5,
                  left: 0,
                  bottom: 0,
                }}
              >
<CartesianGrid vertical={false} stroke="#eeeeee" />

                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: "#8e8e93",
                    fontSize: 10,
                  }}
                  minTickGap={15}
                />

                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: "#8e8e93",
                    fontSize: 10,
                  }}
                  tickFormatter={(value) =>
                    value >= 1000
                      ? `\u20B1${(value / 1000).toFixed(0)}k`
                      : `\u20B1${value}`
                  }
                  width={45}
                />

                <Tooltip
                  cursor={{
                    stroke: "#d9d9d9",
                  }}
                  contentStyle={{
                    border: "1px solid #eeeeee",
                    borderRadius: "12px",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                  }}
                  formatter={(value, name) => [
                    (name === "sales" || name === "Previous period") ? `\u20B1${Number(value).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}`
                      : value,
                    name === "sales" ? "Sales" : name === "Previous period" ? "Previous period" : "Transactions",
                  ]}
                />

                <Bar
                  dataKey="previousSales"
                  name="Previous period"
                  fill="#eeeeee"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />

                <Bar
                  dataKey="sales"
                  fill="#111111"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* ==================================
            INVENTORY INTELLIGENCE
        ================================== */}

        <Card className="smart-card">
          <div className="smart-header">
            <div className="smart-title">
              <div className="smart-icon">
                <BulbOutlined />
              </div>

              <div>
                <div className="smart-heading-row">
                  <Title level={3}>Inventory Intelligence</Title>

                  <span className="smart-ai-pill">
                    <ThunderboltOutlined />
                    SMART
                  </span>
                </div>

                <Text>Products that need attention.</Text>
              </div>
            </div>
          </div>

          {!smartLoading && smartData && (
            <div className="smart-summary">
              <div className="smart-summary-item critical">
                <strong>{smartData.criticalCount}</strong>

                <span>Critical</span>
              </div>

              <div className="smart-summary-item high">
                <strong>{smartData.highCount}</strong>

                <span>High</span>
              </div>

              <div className="smart-summary-item medium">
                <strong>{smartData.mediumCount}</strong>

                <span>Medium</span>
              </div>
            </div>
          )}

          {smartLoading ? (
            <div className="smart-loading">
              <Spin />

              <Text>Analyzing inventory...</Text>
            </div>
          ) : smartRecommendations.length === 0 ? (
            <div className="smart-healthy">
              <CheckCircleOutlined />

              <div>
                <strong>Inventory looks healthy</strong>

                <Text>No immediate action required.</Text>
              </div>
            </div>
          ) : (
            <div className="smart-list">
              {smartRecommendations.map((item) => (
                <div className="smart-product" key={item.product._id}>
                  <div className="smart-product-main">
                    <div className="smart-product-avatar">
                      {item.product.name?.charAt(0).toUpperCase()}
                    </div>

                    <div className="smart-product-info">
                      <strong>{item.product.name}</strong>

                      <span>Stock: {item.currentStock}</span>
                    </div>
                  </div>

                  <div className={`smart-risk ${getRiskClass(item.risk)}`}>
                    {getRiskIcon(item.risk)}

                    {item.risk}
                  </div>

                  <div className="smart-action">
                    <span>Recommended</span>

                    <strong>+{item.recommendedOrder}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* ==================================
          RECENT SALES + BRANCHES
      ================================== */}

      <section className="dashboard-secondary-grid">
        {/* RECENT SALES */}

        <Card className="modern-card">
          <div className="section-header">
            <div>
              <Title level={3}>Recent Sales</Title>

              <Text>Latest completed transactions</Text>
            </div>

            <button type="button" className="text-action">
              View all
              <ArrowRightOutlined />
            </button>
          </div>

          <div className="sales-list">
            {recentSales.length === 0 ? (
              <div className="empty-state">No recent sales.</div>
            ) : (
              recentSales.map((sale) => (
                <div className="sale-row" key={sale._id}>
                  <div className="sale-icon">
                    <ShoppingCartOutlined />
                  </div>

                  <div className="sale-info">
                    <strong>{sale.receiptNumber}</strong>

                    <span>
                      {sale.items?.length === 1
                        ? sale.items[0]?.product?.name || "Product"
                        : `${sale.items?.length || 0} items`}
                    </span>
                  </div>

                  <div className="sale-branch">{sale.branch?.code}</div>

                  <strong className="sale-amount">
                    &#8369;
                    {Number(sale.totalAmount || 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </strong>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* BRANCH OVERVIEW */}

        <Card className="modern-card">
          <div className="section-header">
            <div>
              <Title level={3}>Branch Overview</Title>

              <Text>Current inventory health</Text>
            </div>
          </div>

          <div className="branch-list">
            {branches.length === 0 ? (
              <div className="empty-state">No branch data.</div>
            ) : (
              branches.map((branch) => (
                <div className="branch-item" key={branch.id}>
                  <div className="branch-avatar">
                    <ShopOutlined />
                  </div>

                  <div className="branch-info">
                    <strong>{branch.name}</strong>

                    <span>
                      {branch.code} &middot; {branch.stock.toLocaleString()} units
                    </span>
                  </div>

                  <div
                    className={`branch-health ${
                      branch.lowStock > 0 ? "attention" : "healthy"
                    }`}
                  >
                    <span />

                    {branch.lowStock > 0
                      ? `${branch.lowStock} alert${
                          branch.lowStock > 1 ? "s" : ""
                        }`
                      : "Healthy"}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      {/* ==================================
          STOCK ALERTS
      ================================== */}

      {lowStockItems.length > 0 && (
        <section className="dashboard-section">
          <Card className="modern-card">
            <div className="section-header">
              <div>
                <Title level={3}>Stock Requiring Attention</Title>

                <Text>Products at or below reorder level</Text>
              </div>

              <div className="alert-count">
                {lowStockItems.length}

                <span>items</span>
              </div>
            </div>

            <div className="stock-list">
              {lowStockItems.slice(0, 6).map((item) => {
                const stock = Number(item.quantity);

                const reorder = Number(item.reorderLevel);

                const percentage =
                  reorder > 0 ? Math.min((stock / reorder) * 100, 100) : 0;

                return (
                  <div className="stock-item" key={item._id}>
                    <div className="stock-product">
                      <div className="stock-product-icon">
                        <InboxOutlined />
                      </div>

                      <div>
                        <strong>{item.product?.name}</strong>

                        <span>{item.product?.sku || "No SKU"}</span>
                      </div>
                    </div>

                    <div className="stock-branch">
                      <span>Branch</span>

                      <strong>{item.branch?.code || "N/A"}</strong>
                    </div>

                    <div className="stock-level">
                      <div className="stock-level-text">
                        <strong>{stock}</strong>

                        <span>/ {reorder}</span>
                      </div>

                      <div className="stock-progress">
                        <span
                          style={{
                            width: `${percentage}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="stock-status">
                      <WarningOutlined />
                      Low stock
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </section>
      )}
    </div>
  );
};

export default Dashboard;
