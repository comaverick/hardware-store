import { useEffect, useMemo, useState } from "react";
import {
  Card,
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

import api from "../../services/api";

import "./Reports.css";

const { Text } = Typography

const localDateKey = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const Reports = () => {
  const [sales, setSales] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [period, setPeriod] = useState("WEEK");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get("/sales"), api.get("/inventory")])
      .then(([salesResponse, inventoryResponse]) => {
        setSales(salesResponse.data || []);
        setInventory(inventoryResponse.data || []);
      })
      .catch((error) =>
        message.error(
          error.response?.data?.message || "Could not load reports.",
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
    (item) => Number(item.quantity || 0) <= Number(item.reorderLevel || 0),
  );

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

        <Select
          value={period}
          onChange={setPeriod}
          options={[
            { value: "TODAY", label: "Today" },
            { value: "WEEK", label: "Last 7 days" },
            { value: "MONTH", label: "This month" },
          ]}
        />
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
    </div>
  );
};

export default Reports;
