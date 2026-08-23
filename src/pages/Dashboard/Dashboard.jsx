import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  ArrowRightOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
  ThunderboltOutlined,
  WarningOutlined,
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

const getRefundAmountInRange = (sales, start, end) => sales.reduce((total, sale) => (
  total + (sale.refunds || []).reduce((refundTotal, refund) => {
    const processedAt = new Date(refund.createdAt || sale.updatedAt || sale.createdAt);
    return !Number.isNaN(processedAt.getTime()) && processedAt >= start && processedAt < end
      ? refundTotal + Number(refund.amount || 0)
      : refundTotal;
  }, 0)
), 0);

const Dashboard = ({
  branchScope = {},
  onBranchOptionsChange = () => {},
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";
  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [smartData, setSmartData] = useState(null);

  const [loading, setLoading] = useState(true);
  const [smartLoading, setSmartLoading] = useState(true);

  const [error, setError] = useState(null);

  const selectedBranch = branchScope.selectedBranch || "ALL";

  const [salesPeriod, setSalesPeriod] = useState("WEEK");

  const [chartMetric, setChartMetric] = useState("SALES");

  // ========================================
  // FETCH DASHBOARD
  // ========================================

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        setLoading(true);
        setError(null);

        const [inventoryResponse, salesResponse, productsResponse] = await Promise.all([
          api.get("/inventory"),
          api.get("/sales"),
          api.get("/products"),
        ]);

        setInventory(inventoryResponse.data || []);

        setSales(salesResponse.data || []);
        setProducts(productsResponse.data || []);
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

  useEffect(() => {
    onBranchOptionsChange(availableBranches);
  }, [availableBranches, onBranchOptionsChange]);

  const selectedBranchName = useMemo(() => {
    if (selectedBranch === "ALL") {
      return "All branches";
    }

    return (
      availableBranches.find((branch) => branch.id === selectedBranch)?.name ||
      "All branches"
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

  const productById = new Map(products.map((product) => [String(product._id), product]));
  const getProductPrice = (item, field) => Number(
    item.product?.[field] ?? productById.get(String(item.product?._id))?.[field] ?? 0,
  );

  const inventoryCostValue = filteredInventory.reduce(
    (total, item) => total + Number(item.quantity || 0) * getProductPrice(item, "costPrice"),
    0,
  );

  const inventoryRetailValue = filteredInventory.reduce(
    (total, item) => total + Number(item.quantity || 0) * getProductPrice(item, "sellingPrice"),
    0,
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
  const todayTransactionsLabel = todayTransactions === 1
    ? "1 completed transaction"
    : String(todayTransactions) + " completed transactions";

  const refundPeriod = useMemo(() => {
    const periodStart = new Date();
    periodStart.setHours(0, 0, 0, 0);

    if (salesPeriod === "WEEK") {
      periodStart.setDate(periodStart.getDate() - 6);
    } else if (salesPeriod === "MONTH") {
      periodStart.setDate(1);
    }

    const periodEnd = new Date();
    periodEnd.setHours(0, 0, 0, 0);
    if (salesPeriod === "MONTH") {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd.setDate(periodEnd.getDate() + 1);
    }

    return {
      start: periodStart,
      end: periodEnd,
      label: salesPeriod === "TODAY" ? "Refunds today" : `Refunds this ${salesPeriod.toLowerCase()}`,
    };
  }, [salesPeriod]);

  const refundPeriodSummary = filteredSales.reduce((summary, sale) => {
    (sale.refunds || []).forEach((refund) => {
      const processedAt = new Date(refund.createdAt || sale.updatedAt || sale.createdAt);
      if (!Number.isNaN(processedAt.getTime()) && processedAt >= refundPeriod.start && processedAt < refundPeriod.end) {
        summary.count += 1;
        summary.amount += Number(refund.amount || 0);
      }
    });

    return summary;
  }, { count: 0, amount: 0 });

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
        const refunds = getRefundAmountInRange(filteredSales, bucketStart, bucketEnd);

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
          refunds,
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
      const bucketEnd = new Date(date);
      bucketEnd.setDate(bucketEnd.getDate() + 1);
      const refunds = getRefundAmountInRange(filteredSales, date, bucketEnd);

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
        refunds,
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
    const previousRefunds = getRefundAmountInRange(filteredSales, previousStart, previousEnd);

    return {
      ...bucket,
      previousSales: previousSales.reduce(
        (total, sale) => total + Number(sale.totalAmount || 0),
        0,
      ),
      previousRefunds,
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
  const periodRefundTotal = salesPeriodData.reduce(
    (total, day) => total + day.refunds,
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
  const chartHasActivity = chartMetric === "SALES"
    ? periodSalesTotal > 0 || periodTransactions > 0
    : periodRefundTotal > 0 || refundPeriodSummary.count > 0;
  const chartSummary = chartMetric === "SALES"
    ? chartHasActivity
      ? `Sales totaled ₱${periodSalesTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} across ${periodTransactions} transactions for this ${salesPeriod.toLowerCase()} period, ${periodComparison.comparisonLabel}.`
      : "No completed sales for this period."
    : chartHasActivity
      ? `Refunds totaled ₱${periodRefundTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} across ${refundPeriodSummary.count} processed refunds for this ${salesPeriod.toLowerCase()} period.`
      : "No refunds for this period.";

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

  const getRiskLabel = (risk) => {
    const normalizedRisk = String(risk || "").toLowerCase();
    return normalizedRisk ? `${normalizedRisk.charAt(0).toUpperCase()}${normalizedRisk.slice(1)}` : "Unknown";
  };

  const smartRecommendations =
    smartData?.recommendations
      ?.filter((item) => item.risk !== "LOW" || item.recommendedOrder > 0)
      .slice(0, 4) || [];

  const prioritizeInventory = lowStockItems.length > 0
    || Number(smartData?.criticalCount || 0) > 0
    || Number(smartData?.highCount || 0) > 0;
  const overviewTone = prioritizeInventory && todaySalesAmount === 0 && todayTransactions === 0
    ? "attention"
    : "sales";
  const inventoryPriorityCount = lowStockItems.length > 0
    ? lowStockItems.length
    : Number(smartData?.criticalCount || 0) + Number(smartData?.highCount || 0);

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
      <div className="dashboard dashboard-loading">
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
        </Row>      </div>
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

          <Title level={3}>{greeting}, {user?.name || "there"}</Title>

          <Text className="dashboard-subtitle">
            Here's what's happening across your store today.
          </Text>
        </div>

        <div className="dashboard-scope-context" aria-live="polite">
          <ShopOutlined />
          <span>
            <small>Viewing</small>
            <strong>{selectedBranchName}</strong>
          </span>
        </div>
      </section>

      {/* ==================================
          SYSTEM OVERVIEW
      ================================== */}

      <section className={`dashboard-overview dashboard-overview-${overviewTone}`} aria-labelledby="overview-heading">
        <div className="dashboard-overview-head">
          <div>
            <h2 id="overview-heading">System overview</h2>
            <p>Live operating signals for the selected branch scope.</p>
          </div>

          <div className="overview-live-state">
            <span className="overview-live-dot" aria-hidden="true" />
            Current operating scope
          </div>
        </div>

        <div className="dashboard-overview-grid">
          <article className="overview-primary overview-primary-inventory" aria-label="Inventory attention summary">
            <div className="overview-primary-top">
              <span className="overview-label">Inventory needs attention</span>
              <span className="overview-mark" aria-hidden="true"><WarningOutlined /></span>
            </div>

            <strong className="overview-primary-value">{inventoryPriorityCount.toLocaleString()}</strong>

            <div className="overview-primary-footer">
              <span>{lowStockItems.length > 0 ? "low-stock items" : "items need attention"}</span>
              <button type="button" className="overview-primary-action" onClick={() => navigate("/inventory")}>
                Review inventory
                <ArrowRightOutlined />
              </button>
            </div>
          </article>

          <article className="overview-primary overview-primary-sales">
            <div className="overview-primary-top">
              <span className="overview-label">Today's sales</span>
              <span className="overview-mark" aria-hidden="true">₱</span>
            </div>

            <strong className="overview-primary-value">
              ₱{todaySalesAmount.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}
            </strong>

            <div className="overview-primary-footer">
              <span>{todayTransactionsLabel}</span>
              <span>{selectedBranchName}</span>
            </div>
          </article>

          <div className="overview-stat-list">
            <article className="overview-stat">
              <span className="overview-label">Units on hand</span>
              <strong>{totalStock.toLocaleString()}</strong>
              <span>{selectedBranch === "ALL" ? `${branches.length} branches` : "Current branch"}</span>
            </article>

            <article className="overview-stat">
              <span className="overview-label">Inventory at cost</span>
              <strong>₱{inventoryCostValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
              <span>Value on hand</span>
            </article>

            <article className={`overview-stat overview-stat-low-stock ${lowStockItems.length > 0 ? "overview-stat-warning" : "overview-stat-good"}`}>
              <span className="overview-label">Needs attention</span>
              <strong>{lowStockItems.length}</strong>
              <span>{lowStockItems.length > 0 ? "Low-stock items" : "Inventory healthy"}</span>
            </article>

            <article className="overview-stat">
              <span className="overview-label">Branches in scope</span>
              <strong>{branches.length}</strong>
              <span>{selectedBranch === "ALL" ? "All locations" : "Filtered view"}</span>
            </article>

            <article className="overview-stat overview-stat-sales">
              <span className="overview-label">Today's sales</span>
              <strong>&#8369;{todaySalesAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
              <span>{todayTransactionsLabel}</span>
            </article>
          </div>
        </div>
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
              <Title level={3}>{chartMetric === "SALES" ? "Sales Overview" : "Refund Overview"}</Title>

              <Text className="section-description">
                {chartMetric === "SALES"
                  ? "Your sales performance over time."
                  : "Refund activity over time."}
              </Text>
            </div>

            <div className="sales-overview-controls">
              <div className={`sales-period-selector sales-metric-toggle ${chartMetric === "REFUNDS" ? "refunds-active" : "sales-active"}`} role="group" aria-label="Chart metric">
                <button
                  type="button"
                  className={chartMetric === "SALES" ? "active" : ""}
                  aria-pressed={chartMetric === "SALES"}
                  onClick={() => setChartMetric("SALES")}
                >
                  Sales
                </button>

                <button
                  type="button"
                  className={chartMetric === "REFUNDS" ? "active" : ""}
                  aria-pressed={chartMetric === "REFUNDS"}
                  onClick={() => setChartMetric("REFUNDS")}
                >
                  Refunds
                </button>
              </div>

              <div className={`sales-period-selector sales-range-toggle ${salesPeriod.toLowerCase()}-active`} role="group" aria-label="Chart period">
                <button
                  type="button"
                  className={salesPeriod === "TODAY" ? "active" : ""}
                  aria-pressed={salesPeriod === "TODAY"}
                  onClick={() => setSalesPeriod("TODAY")}
                >
                  Today
                </button>

                <button
                  type="button"
                  className={salesPeriod === "WEEK" ? "active" : ""}
                  aria-pressed={salesPeriod === "WEEK"}
                  onClick={() => setSalesPeriod("WEEK")}
                >
                  Week
                </button>

                <button
                  type="button"
                  className={salesPeriod === "MONTH" ? "active" : ""}
                  aria-pressed={salesPeriod === "MONTH"}
                  onClick={() => setSalesPeriod("MONTH")}
                >
                  Month
                </button>
              </div>
            </div>
            </div>

            <div className="sales-overview-summary">
              <div>
              <span>Sales</span>

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
              <span>Transactions</span>

              <strong>{periodTransactions}</strong>

              <span className={`comparison-note ${periodComparison.transactionChange >= 0 ? "\u2191" : "\u2193"}`}>
                {periodComparison.transactionChange >= 0 ? "\u2191" : "\u2193"} {Math.abs(periodComparison.transactionChange).toFixed(1)}% {periodComparison.comparisonLabel}
              </span>
            </div>

            <div className="refund-overview-summary">
              <span>{refundPeriod.label}</span>
              <strong>
                &#8369;
                {refundPeriodSummary.amount.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                })}
              </strong>
              <span className="comparison-note">{refundPeriodSummary.count} processed</span>
            </div>
          </div>

          <div
            className="sales-chart"
            role="img"
            aria-describedby={chartHasActivity ? "sales-chart-summary" : undefined}
            aria-label={`${chartMetric === "SALES" ? "Sales" : "Refund"} overview chart for the selected ${salesPeriod.toLowerCase()} period`}
          >
            {chartHasActivity ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={salesChartData}
                  barGap={6}
                  barCategoryGap="20%"
                  margin={{
                    top: 10,
                    right: 5,
                    left: 0,
                    bottom: 0,
                  }}
                >
                  <defs>
                    <linearGradient id="dashboard-sales-bar-gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--app-accent-light)" />
                      <stop offset="100%" stopColor="var(--app-accent-deep)" />
                    </linearGradient>

                    <linearGradient id="dashboard-refund-bar-gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--app-warning)" />
                      <stop offset="100%" stopColor="var(--app-accent-deep)" />
                    </linearGradient>
                  </defs>

                  <CartesianGrid vertical={false} stroke="var(--app-chart-grid)" strokeDasharray="2 4" strokeOpacity={0.72} />

                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{
                      fill: "var(--app-muted)",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                    minTickGap={15}
                  />

                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{
                      fill: "var(--app-ink)",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                    tickFormatter={(value) =>
                      value >= 1000
                        ? `\u20B1${(value / 1000).toFixed(0)}k`
                        : `\u20B1${Number(value).toLocaleString()}`
                    }
                    width={48}
                  />

                  <Tooltip
                    cursor={{
                      fill: "var(--app-chart-cursor)",
                      stroke: "var(--app-line-strong)",
                    }}
                    contentStyle={{
                      border: "1px solid var(--app-glass-border)",
                      borderRadius: "10px",
                      background: "var(--app-glass-background-raised)",
                      boxShadow: "var(--app-glass-shadow)",
                      padding: "10px 12px",
                    }}
                    labelStyle={{
                      color: "var(--app-ink)",
                      fontWeight: 700,
                      marginBottom: "4px",
                    }}
                    itemStyle={{
                      color: "var(--app-muted)",
                      padding: "2px 0",
                    }}
                    formatter={(value, name) => [
                      `\u20B1${Number(value).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}`,
                      name === "sales" || name === "Sales" ? "Sales" : name === "refunds" || name === "Refunds" ? "Refunds" : "Previous period",
                    ]}
                  />

                  <Bar
                    dataKey={chartMetric === "SALES" ? "previousSales" : "previousRefunds"}
                    name="Previous period"
                    fill="var(--app-chart-previous)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={20}
                  />

                  <Bar
                    dataKey={chartMetric === "SALES" ? "sales" : "refunds"}
                    name={chartMetric === "SALES" ? "Sales" : "Refunds"}
                    fill={chartMetric === "REFUNDS" ? "url(#dashboard-refund-bar-gradient)" : "url(#dashboard-sales-bar-gradient)"}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div id="sales-chart-summary" className="sales-chart-empty">
                <strong>{chartSummary}</strong>
                <span>Choose another period to view activity.</span>
              </div>
            )}
          </div>

          {chartHasActivity && (
            <p id="sales-chart-summary" className="sales-chart-summary">{chartSummary}</p>
          )}
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
                    Smart
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

                    {getRiskLabel(item.risk)}
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

            <button
              type="button"
              className="text-action"
              onClick={() => navigate("/reports")}
              aria-label="View all sales reports"
            >
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

        <Card className="modern-card branch-overview-card">
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

          <div className="inventory-value-summary">
            <div>
              <span>Cost value on hand</span>
              <strong>&#8369;{inventoryCostValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
            </div>
            <div>
              <span>Potential retail value</span>
              <strong>&#8369;{inventoryRetailValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
            </div>
          </div>
          {totalStock > 0 && inventoryCostValue === 0 && (
            <div className="inventory-value-warning">Add product cost prices to calculate inventory value.</div>
          )}
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
