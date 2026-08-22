import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  Button,
  Col,
  Empty,
  Row,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DownloadOutlined } from "@ant-design/icons";

import api from "../../services/api";

import "./Reports.css";

const { Text } = Typography

const localDateKey = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const money = (value) => `\u20B1${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

const getRefundAmountInRange = (sales, start, end) => sales.reduce((total, sale) => (
  total + (sale.refunds || []).reduce((refundTotal, refund) => {
    const processedAt = new Date(refund.createdAt || sale.updatedAt || sale.createdAt);
    return !Number.isNaN(processedAt.getTime()) && processedAt >= start && processedAt < end
      ? refundTotal + Number(refund.amount || 0)
      : refundTotal;
  }, 0)
), 0);

const Reports = () => {
  const [sales, setSales] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [period, setPeriod] = useState("WEEK");
  const [chartMetric, setChartMetric] = useState("SALES");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get("/sales"), api.get("/inventory"), api.get("/products")])
      .then(([salesResponse, inventoryResponse, productsResponse]) => {
        setSales(salesResponse.data || []);
        setInventory(inventoryResponse.data || []);
        setProducts(productsResponse.data || []);
      })
      .catch((error) =>
        message.error(
          error.userMessage || error.response?.data?.message || "Could not load reports.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const completedSales = useMemo(
    () => sales.filter((sale) => sale.status === "COMPLETED"),
    [sales],
  );
  const cutoff = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    if (period === "TODAY") return date;
    if (period === "MONTH") date.setDate(1);
    else date.setDate(date.getDate() - 6);
    return date;
  }, [period]);
  const periodSales = completedSales.filter(
    (sale) => new Date(sale.createdAt) >= cutoff,
  );
  const revenue = periodSales.reduce(
    (sum, sale) => sum + Number(sale.totalAmount || 0),
    0,
  );
  const lowStock = inventory.filter(
    (item) => Number(item.quantity || 0) <= Number(item.reorderLevel ?? item.product?.reorderLevel ?? 0),
  );

  const productById = useMemo(
    () => new Map(products.map((product) => [String(product._id), product])),
    [products],
  );
  const getProductPrice = useCallback((item, field) => Number(
    item.product?.[field] ?? productById.get(String(item.product?._id))?.[field] ?? 0,
  ), [productById]);

  const inventoryMetrics = useMemo(() => inventory.reduce((summary, item) => {
    const quantity = Number(item.quantity || 0);
    const costPrice = getProductPrice(item, "costPrice");
    const sellingPrice = getProductPrice(item, "sellingPrice");
    summary.costValue += quantity * costPrice;
    summary.retailValue += quantity * sellingPrice;
    summary.units += quantity;
    return summary;
  }, { costValue: 0, retailValue: 0, units: 0 }), [getProductPrice, inventory]);

  const estimatedProfit = useMemo(() => periodSales.reduce((sum, sale) => (
    sum + (sale.items || []).reduce((itemSum, item) => {
      const cost = Number(item.product?.costPrice || 0);
      return itemSum + (Number(item.unitPrice || 0) - cost) * Number(item.quantity || 0);
    }, 0)
  ), 0), [periodSales]);

  const marginPercent = revenue ? (estimatedProfit / revenue) * 100 : 0;

  const refundSummary = useMemo(() => sales.reduce((summary, sale) => {
    (sale.refunds || []).forEach((refund) => {
      const refundDate = new Date(refund.createdAt || sale.updatedAt || sale.createdAt);
      if (Number.isNaN(refundDate.getTime()) || refundDate < cutoff) return;

      const reason = refund.reason || "No reason provided";
      const amount = Number(refund.amount || 0);
      summary.count += 1;
      summary.amount += amount;
      summary.byReason[reason] = (summary.byReason[reason] || 0) + amount;
      summary.activity.push({
        key: `${sale._id}-${refund.createdAt}`,
        receipt: sale.receiptNumber || sale._id,
        reason,
        amount,
        createdAt: refundDate,
      });
    });
    return summary;
  }, { count: 0, amount: 0, byReason: {}, activity: [] }), [cutoff, sales]);

  const slowMovingProducts = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 29);
    const sold = new Map();

    completedSales
      .filter((sale) => new Date(sale.createdAt) >= cutoffDate)
      .forEach((sale) => (sale.items || []).forEach((item) => {
        const product = item.product;
        if (!product?._id) return;
        const key = String(product._id);
        const current = sold.get(key) || { product, unitsSold: 0, revenue: 0 };
        current.unitsSold += Number(item.quantity || 0);
        current.revenue += Number(item.subtotal || item.unitPrice * item.quantity || 0);
        sold.set(key, current);
      }));

    const onHand = new Map();
    inventory.forEach((item) => {
      if (!item.product?._id) return;
      const key = String(item.product._id);
      onHand.set(key, (onHand.get(key) || 0) + Number(item.quantity || 0));
    });

    return inventory
      .map((item) => item.product)
      .filter((product, index, products) => product?._id && products.findIndex((candidate) => String(candidate?._id) === String(product._id)) === index)
      .map((product) => ({
        key: String(product._id),
        product,
        unitsSold: sold.get(String(product._id))?.unitsSold || 0,
        revenue: sold.get(String(product._id))?.revenue || 0,
        onHand: onHand.get(String(product._id)) || 0,
      }))
      .sort((a, b) => a.unitsSold - b.unitsSold || b.onHand - a.onHand)
      .slice(0, 10);
  }, [completedSales, inventory]);

  const exportCsv = () => {
    const rows = [
      ["Hardware Store Report", period],
      [],
      ["Metric", "Value"],
      ["Revenue", revenue],
      ["Completed transactions", periodSales.length],
      ["Refunds processed", refundSummary.count],
      ["Refund amount", refundSummary.amount],
      ["Estimated gross profit", estimatedProfit],
      ["Estimated margin", `${marginPercent.toFixed(2)}%`],
      ["Inventory cost value", inventoryMetrics.costValue],
      ["Inventory retail value", inventoryMetrics.retailValue],
      [],
      ["Branch", "Revenue", "Transactions"],
      ...branchData.map((item) => [item.branch, item.revenue, item.transactions]),
      [],
      ["Slow-moving product", "SKU", "Units sold (30 days)", "On hand", "Revenue (30 days)"],
      ...slowMovingProducts.map((item) => [item.product.name, item.product.sku, item.unitsSold, item.onHand, item.revenue]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `hardware-store-report-${period.toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const chartData = useMemo(() => {
    if (period === "TODAY") {
      const todayStart = new Date(cutoff);
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);

      return Array.from({ length: 24 }, (_, hour) => {
        const currentStart = new Date(todayStart);
        currentStart.setHours(hour, 0, 0, 0);
        const currentEnd = new Date(currentStart);
        currentEnd.setHours(hour + 1, 0, 0, 0);
        const previousStart = new Date(yesterdayStart);
        previousStart.setHours(hour, 0, 0, 0);
        const previousEnd = new Date(previousStart);
        previousEnd.setHours(hour + 1, 0, 0, 0);
        const currentSales = periodSales.filter((sale) => {
          const date = new Date(sale.createdAt);
          return date >= currentStart && date < currentEnd;
        });
        const previousSales = completedSales.filter((sale) => {
          const date = new Date(sale.createdAt);
          return date >= previousStart && date < previousEnd;
        });
        return {
          label: currentStart.toLocaleTimeString("en-US", { hour: "numeric" }),
          revenue: currentSales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
          previousRevenue: previousSales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
          refunds: getRefundAmountInRange(sales, currentStart, currentEnd),
          previousRefunds: getRefundAmountInRange(sales, previousStart, previousEnd),
          transactions: currentSales.length,
        };
      });
    }

    const days = period === "MONTH" ? new Date().getDate() : 7;
    const start = new Date(cutoff);
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = localDateKey(date);
      const previousDate = new Date(date);
      previousDate.setDate(previousDate.getDate() - (period === "MONTH" ? 30 : 7));
      const previousKey = localDateKey(previousDate);
      const daily = periodSales.filter((sale) => localDateKey(sale.createdAt) === key);
      const previousDaily = completedSales.filter((sale) => localDateKey(sale.createdAt) === previousKey);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      return {
        label: period === "MONTH" ? date.getDate() : date.toLocaleDateString("en-US", { weekday: "short" }),
        revenue: daily.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
        previousRevenue: previousDaily.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
        refunds: getRefundAmountInRange(sales, date, nextDate),
        previousRefunds: getRefundAmountInRange(sales, previousDate, date),
        transactions: daily.length,
      };
    });
  }, [completedSales, cutoff, period, periodSales, sales]);

  const branchData = useMemo(() => {
    const map = new Map();
    periodSales.forEach((sale) => {
      const id = sale.branch?._id || "unknown";
      const current = map.get(id) || {
        branch: sale.branch?.name || "Unknown branch",
        revenue: 0,
        transactions: 0,
      };
      current.revenue += Number(sale.totalAmount || 0);
      current.transactions += 1;
      map.set(id, current);
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }, [periodSales]);

  const columns = [
    {
      title: "Product",
      dataIndex: "product",
      render: (product) => product?.name || "Unknown product",
    },
    {
      title: "Branch",
      dataIndex: "branch",
      render: (branch) => branch?.code || branch?.name || "-",
    },
    { title: "On hand", dataIndex: "quantity" },
    { title: "Reorder at", dataIndex: "reorderLevel" },
    {
      title: "Status",
      render: () => <Tag color="orange">Needs attention</Tag>,
    },
  ];

  const hasChartData = chartData.some((bucket) => bucket.revenue > 0 || bucket.refunds > 0);

  if (loading)
    return (
      <div className="reports-loading">
        <Spin size="large" />
      </div>
    );

  return (
    <div className="reports-page">
      <div className="reports-header">
        <div className="reports-header-copy">
          <Text className="reports-eyebrow">REPORTING</Text>
          <h1>Reports &amp; analytics</h1>
          <p>Review sales performance, inventory health, and refund activity.</p>
        </div>

        <div className="reports-header-actions">
          <div className={`reports-period-toggle ${period.toLowerCase()}-active`}>
            <button
              type="button"
              className={period === "TODAY" ? "active" : ""}
              aria-pressed={period === "TODAY"}
              onClick={() => setPeriod("TODAY")}
            >
              Today
            </button>
            <button
              type="button"
              className={period === "WEEK" ? "active" : ""}
              aria-pressed={period === "WEEK"}
              onClick={() => setPeriod("WEEK")}
            >
              7 days
            </button>
            <button
              type="button"
              className={period === "MONTH" ? "active" : ""}
              aria-pressed={period === "MONTH"}
              onClick={() => setPeriod("MONTH")}
            >
              Month
            </button>
          </div>
          <Button className="reports-export-button" icon={<DownloadOutlined />} onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </div>

      <Row gutter={[16, 16]} className="reports-stat-row">
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Revenue"
              prefix={"\u20B1"}
              value={revenue}
              precision={2}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Estimated gross profit" prefix={"₱"} value={estimatedProfit} precision={2} />
            <Text type="secondary">Estimated margin: {marginPercent.toFixed(1)}%</Text>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Inventory cost value" prefix={"₱"} value={inventoryMetrics.costValue} precision={2} />
            <Text type="secondary">Retail value: {money(inventoryMetrics.retailValue)}</Text>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Completed sales" value={periodSales.length} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Low-stock items"
              value={lowStock.length}
              valueStyle={{ color: lowStock.length ? "#d46b08" : "#389e0d" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Refunds processed"
              value={refundSummary.count}
              suffix={money(refundSummary.amount)}
              valueStyle={{ color: refundSummary.count ? "#d46b08" : "#389e0d" }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card
            title={chartMetric === "SALES" ? "Sales trend" : "Refund trend"}
            extra={(
              <div className="reports-chart-actions">
                <div className={`reports-metric-toggle ${chartMetric.toLowerCase()}-active`}>
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
                <span className="reports-chart-period">{period === "TODAY" ? "Today" : period === "WEEK" ? "Last 7 days" : "This month"}</span>
              </div>
            )}
            className="reports-card reports-chart-card"
          >
            {hasChartData ? (
              <ResponsiveContainer width="100%" height={310}>
                <BarChart data={chartData} barGap={-20} margin={{ top: 12, right: 4, left: 0, bottom: 4 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e1e1e5"
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#8a8a91", fontSize: 11 }}
                    tickMargin={10}
                    minTickGap={18}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#8a8a91", fontSize: 11 }}
                    tickMargin={8}
                    width={58}
                    tickFormatter={(value) => value >= 1000 ? `\u20B1${(value / 1000).toFixed(0)}k` : `\u20B1${value}`}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(80, 80, 86, 0.05)" }}
                    contentStyle={{
                      border: "1px solid #dedee2",
                      borderRadius: "12px",
                      boxShadow: "0 10px 24px rgba(0, 0, 0, 0.1)",
                      fontSize: 12,
                    }}
                    formatter={(value, name) => [
                      `\u20B1${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
                      name === "Refunds" ? "Refunds" : name === "Previous period" ? "Previous period" : "Revenue",
                    ]}
                  />
                  <Bar
                    dataKey={chartMetric === "SALES" ? "previousRevenue" : "previousRefunds"}
                    name="Previous period"
                    fill="#d7d7dc"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey={chartMetric === "SALES" ? "revenue" : "refunds"}
                    name={chartMetric === "SALES" ? "Revenue" : "Refunds"}
                    fill="#4b4b50"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={22}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description={chartMetric === "SALES" ? "No completed sales in this period." : "No refunds in this period."} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card
            title="Branch performance"
            className="reports-card reports-branch-card"
          >
            {branchData.length ? (
              branchData.map((item) => (
                <div className="reports-branch-row" key={item.branch}>
                  <div>
                    <strong>{item.branch}</strong>
                    <Text type="secondary">
                      {item.transactions} transactions
                    </Text>
                  </div>
                  <strong>
                    {"\u20B1"}
                    {item.revenue.toLocaleString("en-PH", {
                      minimumFractionDigits: 2,
                    })}
                  </strong>
                </div>
              ))
            ) : (
              <Empty description="No branch sales yet." />
            )}
          </Card>
        </Col>
      </Row>

      <Card
        title="Inventory requiring attention"
        className="reports-card reports-low-stock"
      >
        {lowStock.length ? (
          <Table
            rowKey="_id"
            columns={columns}
            dataSource={lowStock}
            pagination={{ pageSize: 8 }}
          />
        ) : (
          <Empty description="Inventory levels look healthy." />
        )}
      </Card>

      <Row gutter={[16, 16]} className="reports-secondary-row">
        <Col xs={24} lg={14}>
          <Card title="Slow-moving products - last 30 days" className="reports-card">
            <Table
              rowKey="key"
              size="small"
              pagination={{ pageSize: 5 }}
              dataSource={slowMovingProducts}
              columns={[
                { title: "Product", dataIndex: ["product", "name"] },
                { title: "SKU", dataIndex: ["product", "sku"] },
                { title: "Sold", dataIndex: "unitsSold" },
                { title: "On hand", dataIndex: "onHand" },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Inventory value" className="reports-card">
            <div className="reports-value-list">
              <div><span>Units on hand</span><strong>{inventoryMetrics.units.toLocaleString()}</strong></div>
              <div><span>Cost value</span><strong>{money(inventoryMetrics.costValue)}</strong></div>
              <div><span>Potential retail value</span><strong>{money(inventoryMetrics.retailValue)}</strong></div>
              <div><span>Potential gross value gain</span><strong>{money(inventoryMetrics.retailValue - inventoryMetrics.costValue)}</strong></div>
            </div>
          </Card>
        </Col>
        <Col xs={24}>
          <Card title="Refund activity" className="reports-card">
            {refundSummary.activity.length ? (
              <Table
                rowKey="key"
                size="small"
                pagination={{ pageSize: 5 }}
                dataSource={[...refundSummary.activity].sort((a, b) => b.createdAt - a.createdAt)}
                columns={[
                  { title: "Receipt", dataIndex: "receipt" },
                  { title: "Reason", dataIndex: "reason" },
                  { title: "Amount", dataIndex: "amount", render: (value) => money(value) },
                  { title: "Processed", dataIndex: "createdAt", render: (value) => value.toLocaleString() },
                ]}
              />
            ) : (
              <Empty description="No refunds in this period." />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Reports;
