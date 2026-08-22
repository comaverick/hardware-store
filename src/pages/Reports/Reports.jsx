import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  Button,
  Col,
  Empty,
  Row,
  Select,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
  Space,
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

const Reports = () => {
  const [sales, setSales] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [period, setPeriod] = useState("WEEK");
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
      return {
        label: period === "MONTH" ? date.getDate() : date.toLocaleDateString("en-US", { weekday: "short" }),
        revenue: daily.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
        previousRevenue: previousDaily.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0),
        transactions: daily.length,
      };
    });
  }, [completedSales, cutoff, period, periodSales]);

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

  if (loading)
    return (
      <div className="reports-loading">
        <Spin size="large" />
      </div>
    );

  return (
    <div className="reports-page">
      <div className="reports-header">
        <Space>
          <Select
            className="reports-period-select"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "TODAY", label: "Today" },
              { value: "WEEK", label: "Last 7 days" },
              { value: "MONTH", label: "This month" },
            ]}
          />
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>Export CSV</Button>
        </Space>
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
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title="Sales trend" className="reports-card">
            {periodSales.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} barGap={-18}>
<CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e5e5ea"
                  />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `\u20B1${value}`}
                  />
                  <Tooltip
                    formatter={(value) => [
                      `\u20B1${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
                      "Revenue",
                    ]}
                  />
                  <Bar
                    dataKey="previousRevenue"
                    name="Previous period"
                    fill="#eeeeee"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={32}
                  />
                  <Bar
                    dataKey="revenue"
                    fill="#111111"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={32}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="No completed sales in this period." />
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
      </Row>
    </div>
  );
};

export default Reports;
