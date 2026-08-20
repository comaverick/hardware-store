import { useEffect, useMemo, useState } from "react";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  HistoryOutlined,
  SearchOutlined,
  SwapOutlined,
} from "@ant-design/icons";

import {
  Card,
  Col,
  Empty,
  Input,
  Row,
  Select,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";

import api from "../../services/api";

import "./StockHistory.css";

const { Title, Text } = Typography;

const StockHistory = () => {
  const [transactions, setTransactions] = useState([]);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [branchFilter, setBranchFilter] = useState("all");

  const [typeFilter, setTypeFilter] = useState("all");

  // =========================
  // FETCH TRANSACTIONS
  // =========================

  const fetchTransactions = async () => {
    try {
      setLoading(true);

      const response = await api.get("/inventory-transactions");

      setTransactions(response.data);
    } catch (error) {
      console.error("Stock history error:", error);

      message.error(
        error.response?.data?.message || "Failed to load stock history.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  // =========================
  // BRANCHES
  // =========================

  const branches = useMemo(() => {
    const branchMap = new Map();

    transactions.forEach((transaction) => {
      if (transaction.branch?._id) {
        branchMap.set(transaction.branch._id, transaction.branch);
      }
    });

    return Array.from(branchMap.values());
  }, [transactions]);

  // =========================
  // FILTER
  // =========================

  const filteredTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      const searchValue = search.toLowerCase().trim();

      const productName = transaction.product?.name?.toLowerCase() || "";

      const sku = transaction.product?.sku?.toLowerCase() || "";

      const branchName = transaction.branch?.name?.toLowerCase() || "";

      const branchCode = transaction.branch?.code?.toLowerCase() || "";

      const reason = transaction.reason?.toLowerCase() || "";

      const reference = transaction.reference?.toLowerCase() || "";

      const matchesSearch =
        !searchValue ||
        productName.includes(searchValue) ||
        sku.includes(searchValue) ||
        branchName.includes(searchValue) ||
        branchCode.includes(searchValue) ||
        reason.includes(searchValue) ||
        reference.includes(searchValue);

      const matchesBranch =
        branchFilter === "all" || transaction.branch?._id === branchFilter;

      const matchesType =
        typeFilter === "all" || transaction.type === typeFilter;

      return matchesSearch && matchesBranch && matchesType;
    });
  }, [transactions, search, branchFilter, typeFilter]);

  // =========================
  // STATISTICS
  // =========================

  const stockInCount = transactions.filter(
    (transaction) => transaction.type === "STOCK_IN",
  ).length;

  const stockOutCount = transactions.filter(
    (transaction) => transaction.type === "STOCK_OUT",
  ).length;

  const transferCount = transactions.filter(
    (transaction) =>
      transaction.type === "TRANSFER_IN" || transaction.type === "TRANSFER_OUT",
  ).length;

  const adjustmentCount = transactions.filter(
    (transaction) => transaction.type === "ADJUSTMENT",
  ).length;

  // =========================
  // MOVEMENT DISPLAY
  // =========================

  const getMovement = (transaction) => {
    switch (transaction.type) {
      case "STOCK_IN":
        return {
          label: "Stock In",
          color: "green",
          icon: <ArrowDownOutlined />,
        };

      case "STOCK_OUT":
        return {
          label: "Stock Out",
          color: "red",
          icon: <ArrowUpOutlined />,
        };

      case "TRANSFER_IN":
        return {
          label: "Transfer In",
          color: "blue",
          icon: <ArrowDownOutlined />,
        };

      case "TRANSFER_OUT":
        return {
          label: "Transfer Out",
          color: "purple",
          icon: <ArrowUpOutlined />,
        };

      case "ADJUSTMENT":
        return {
          label: "Adjustment",
          color: "orange",
          icon: <SwapOutlined />,
        };

      default:
        return {
          label: transaction.type,
          color: "default",
          icon: null,
        };
    }
  };

  // =========================
  // TABLE
  // =========================

  const columns = [
    {
      title: "Date",
      key: "date",
      width: 180,

      render: (_, transaction) => (
        <div className="history-date">
          <strong>
            {new Date(transaction.createdAt).toLocaleDateString("en-PH", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </strong>

          <Text type="secondary">
            {new Date(transaction.createdAt).toLocaleTimeString("en-PH", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </div>
      ),
    },

    {
      title: "Product",
      key: "product",

      render: (_, transaction) => (
        <div>
          <div className="history-product">
            {transaction.product?.name || "Unknown Product"}
          </div>

          <Text type="secondary">{transaction.product?.sku || "No SKU"}</Text>
        </div>
      ),
    },

    {
      title: "Branch",
      key: "branch",

      render: (_, transaction) => (
        <div>
          <div className="history-branch">
            {transaction.branch?.name || "Unknown Branch"}
          </div>

          <Text type="secondary">{transaction.branch?.code || "N/A"}</Text>
        </div>
      ),
    },

    {
      title: "Movement",
      key: "movement",

      render: (_, transaction) => {
        const movement = getMovement(transaction);

        return (
          <Tag color={movement.color} icon={movement.icon}>
            {movement.label}
          </Tag>
        );
      },
    },

    {
      title: "Quantity",
      key: "quantity",

      render: (_, transaction) => {
        const isIncoming =
          transaction.type === "STOCK_IN" || transaction.type === "TRANSFER_IN";

        const isOutgoing =
          transaction.type === "STOCK_OUT" ||
          transaction.type === "TRANSFER_OUT";

        let prefix = "";

        if (isIncoming) {
          prefix = "+";
        }

        if (isOutgoing) {
          prefix = "-";
        }

        return (
          <strong
            className={
              isIncoming
                ? "quantity-in"
                : isOutgoing
                  ? "quantity-out"
                  : "quantity-adjustment"
            }
          >
            {prefix}
            {transaction.quantity}
          </strong>
        );
      },
    },

    {
      title: "Stock Change",
      key: "stockChange",

      render: (_, transaction) => (
        <div className="stock-change">
          <Text type="secondary">{transaction.previousQuantity}</Text>

          <span>→</span>

          <strong>{transaction.newQuantity}</strong>
        </div>
      ),
    },

    {
      title: "Reason",
      key: "reason",

      render: (_, transaction) => <Text>{transaction.reason || "—"}</Text>,
    },

    {
      title: "Reference",
      key: "reference",

      render: (_, transaction) =>
        transaction.reference ? (
          <Tag>{transaction.reference}</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },

    {
      title: "Performed By",
      key: "performedBy",

      render: (_, transaction) => (
        <div>
          <div>{transaction.performedBy?.name || "Unknown User"}</div>

          <Text type="secondary">{transaction.performedBy?.role || ""}</Text>
        </div>
      ),
    },
  ];

  return (
    <div className="stock-history-page">
      {/* =========================
          HEADER
      ========================= */}

      <div className="stock-history-header">
        <div>
          <Title level={2}>Stock History</Title>

          <Text type="secondary">
            Complete audit trail of inventory movements
          </Text>
        </div>

        <Tag icon={<HistoryOutlined />} className="history-count-tag">
          {transactions.length} Transactions
        </Tag>
      </div>

      {/* =========================
          STATISTICS
      ========================= */}

      <Row gutter={[16, 16]} className="history-stats">
        <Col xs={24} sm={12} lg={6}>
          <Card className="history-stat-card">
            <Statistic
              title="Stock Received"
              value={stockInCount}
              prefix={<ArrowDownOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="history-stat-card">
            <Statistic
              title="Stock Released"
              value={stockOutCount}
              prefix={<ArrowUpOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="history-stat-card">
            <Statistic
              title="Transfers"
              value={transferCount}
              prefix={<SwapOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="history-stat-card">
            <Statistic title="Adjustments" value={adjustmentCount} />
          </Card>
        </Col>
      </Row>

      {/* =========================
          FILTERS
      ========================= */}

      <Card className="history-filter-card">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={10} lg={12}>
            <Input
              size="large"
              prefix={<SearchOutlined />}
              placeholder="Search product, SKU, branch, reason, or reference..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </Col>

          <Col xs={24} md={7} lg={6}>
            <Select
              size="large"
              value={branchFilter}
              onChange={setBranchFilter}
              style={{
                width: "100%",
              }}
            >
              <Select.Option value="all">All Branches</Select.Option>

              {branches.map((branch) => (
                <Select.Option key={branch._id} value={branch._id}>
                  {branch.code}
                </Select.Option>
              ))}
            </Select>
          </Col>

          <Col xs={24} md={7} lg={6}>
            <Select
              size="large"
              value={typeFilter}
              onChange={setTypeFilter}
              style={{
                width: "100%",
              }}
            >
              <Select.Option value="all">All Movements</Select.Option>

              <Select.Option value="STOCK_IN">Stock In</Select.Option>

              <Select.Option value="STOCK_OUT">Stock Out</Select.Option>

              <Select.Option value="TRANSFER_IN">Transfer In</Select.Option>

              <Select.Option value="TRANSFER_OUT">Transfer Out</Select.Option>

              <Select.Option value="ADJUSTMENT">Adjustment</Select.Option>
            </Select>
          </Col>
        </Row>
      </Card>

      {/* =========================
          HISTORY TABLE
      ========================= */}

      <Card className="history-table-card">
        <div className="history-table-header">
          <div>
            <Title level={5}>Inventory Movements</Title>

            <Text type="secondary">
              Showing {filteredTransactions.length} of {transactions.length}{" "}
              transactions
            </Text>
          </div>
        </div>

        <Table
          columns={columns}
          dataSource={filteredTransactions}
          rowKey="_id"
          loading={loading}
          scroll={{
            x: 1300,
          }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,

            showTotal: (total) => `${total} transactions`,
          }}
          locale={{
            emptyText: <Empty description="No stock movements found" />,
          }}
        />
      </Card>
    </div>
  );
};

export default StockHistory;
