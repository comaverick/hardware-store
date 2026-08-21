import { useEffect, useMemo, useState } from "react";

import {
  AppstoreOutlined,
  ArrowRightOutlined,
  InboxOutlined,
  SearchOutlined,
  SwapOutlined,
  WarningOutlined,
  HistoryOutlined,
} from "@ant-design/icons";

import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";

import api from "../../services/api";

import "./Inventory.css";

const { Title, Text } = Typography;

const Inventory = () => {
  const [inventory, setInventory] = useState([]);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [branchFilter, setBranchFilter] = useState("all");

  const [statusFilter, setStatusFilter] = useState("all");

  const [actionModal, setActionModal] = useState(null);

  const [saving, setSaving] = useState(false);

  const [transactions, setTransactions] = useState([]);

  const [historyOpen, setHistoryOpen] = useState(false);

  const [receiveForm] = Form.useForm();
  const [adjustForm] = Form.useForm();
  const [transferForm] = Form.useForm();

  // =========================
  // FETCH INVENTORY
  // =========================

  const fetchInventory = async () => {
    try {
      setLoading(true);

      const response = await api.get("/inventory");

      setInventory(response.data);
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to load inventory.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  // =========================
  // FETCH TRANSACTIONS
  // =========================

  const fetchTransactions = async () => {
    try {
      const response = await api.get("/inventory-transactions");

      setTransactions(response.data);
    } catch (error) {
      console.error(error);

      message.error("Failed to load transaction history.");
    }
  };

  // =========================
  // BRANCHES
  // =========================

  const branches = useMemo(() => {
    const branchMap = new Map();

    inventory.forEach((item) => {
      if (item.branch?._id) {
        branchMap.set(item.branch._id, item.branch);
      }
    });

    return Array.from(branchMap.values());
  }, [inventory]);

  // =========================
  // STATUS
  // =========================

  const getStockStatus = (item) => {
    const quantity = item.quantity;

    const reorderLevel = item.reorderLevel || 0;

    if (quantity === 0) {
      return "OUT";
    }

    if (quantity <= reorderLevel) {
      return "LOW";
    }

    if (quantity <= reorderLevel * 2) {
      return "WARNING";
    }

    return "HEALTHY";
  };

  // =========================
  // FILTER
  // =========================

  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      const searchValue = search.toLowerCase().trim();

      const productName = item.product?.name?.toLowerCase() || "";

      const sku = item.product?.sku?.toLowerCase() || "";

      const branchCode = item.branch?.code?.toLowerCase() || "";

      const matchesSearch =
        !searchValue ||
        productName.includes(searchValue) ||
        sku.includes(searchValue) ||
        branchCode.includes(searchValue);

      const matchesBranch =
        branchFilter === "all" || item.branch?._id === branchFilter;

      const matchesStatus =
        statusFilter === "all" || getStockStatus(item) === statusFilter;

      return matchesSearch && matchesBranch && matchesStatus;
    });
  }, [inventory, search, branchFilter, statusFilter]);

  // =========================
  // STATISTICS
  // =========================

  const totalStock = inventory.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  const lowStockCount = inventory.filter(
    (item) => getStockStatus(item) === "LOW",
  ).length;

  const outOfStockCount = inventory.filter(
    (item) => getStockStatus(item) === "OUT",
  ).length;

  const healthyCount = inventory.filter(
    (item) => getStockStatus(item) === "HEALTHY",
  ).length;

  // =========================
  // RECEIVE STOCK
  // =========================

  const handleReceive = async (values) => {
    try {
      setSaving(true);

      await api.post("/inventory-transactions/receive", values);

      message.success("Stock received successfully.");

      receiveForm.resetFields();

      setActionModal(null);

      await fetchInventory();
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to receive stock.",
      );
    } finally {
      setSaving(false);
    }
  };

  // =========================
  // ADJUST STOCK
  // =========================

  const handleAdjust = async (values) => {
    try {
      setSaving(true);

      await api.post("/inventory-transactions/adjust", values);

      message.success("Stock adjusted successfully.");

      adjustForm.resetFields();

      setActionModal(null);

      await fetchInventory();
    } catch (error) {
      console.error(error);

      message.error(error.response?.data?.message || "Failed to adjust stock.");
    } finally {
      setSaving(false);
    }
  };

  // =========================
  // TRANSFER STOCK
  // =========================

  const handleTransfer = async (values) => {
    try {
      setSaving(true);

      await api.post("/inventory-transactions/transfer", values);

      message.success("Stock transferred successfully.");

      transferForm.resetFields();

      setActionModal(null);

      await fetchInventory();
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to transfer stock.",
      );
    } finally {
      setSaving(false);
    }
  };

  // =========================
  // TABLE
  // =========================

  const columns = [
    {
      title: "Product",
      key: "product",

      render: (_, item) => (
        <div className="inventory-product">
          <div className="inventory-product-icon">
            <AppstoreOutlined />
          </div>

          <div>
            <div className="inventory-product-name">{item.product?.name}</div>

            <div className="inventory-product-sku">{item.product?.sku}</div>
          </div>
        </div>
      ),
    },

    {
      title: "Branch",
      key: "branch",

      render: (_, item) => (
        <div>
          <div className="inventory-branch-name">{item.branch?.name}</div>

          <Text type="secondary">{item.branch?.code}</Text>
        </div>
      ),
    },

    {
      title: "Stock",
      key: "stock",

      render: (_, item) => (
        <div>
          <strong>
            {item.quantity} {item.product?.unit || "pcs"}
          </strong>
          <div className="inventory-reserved">
            {item.reservedQuantity || 0} reserved
          </div>
        </div>
      ),
    },

    {
      title: "Reorder",
      dataIndex: "reorderLevel",
      key: "reorder",
    },

    {
      title: "Shelf",
      dataIndex: "shelfLocation",
      key: "shelf",

      render: (value) => <Tag>{value || "Not assigned"}</Tag>,
    },

    {
      title: "Status",
      key: "status",

      render: (_, item) => {
        const status = getStockStatus(item);

        if (status === "OUT") {
          return <Tag color="red">Out of Stock</Tag>;
        }

        if (status === "LOW") {
          return <Tag color="red">Low Stock</Tag>;
        }

        if (status === "WARNING") {
          return <Tag color="orange">Watch</Tag>;
        }

        return <Tag color="green">Healthy</Tag>;
      },
    },
  ];

  // =========================
  // TRANSACTION TABLE
  // =========================

  const transactionColumns = [
    {
      title: "Date",
      dataIndex: "createdAt",
      key: "date",

      render: (value) => new Date(value).toLocaleString(),
    },

    {
      title: "Product",
      key: "product",

      render: (_, item) => item.product?.name || "Unknown",
    },

    {
      title: "Branch",
      key: "branch",

      render: (_, item) => item.branch?.code || "Unknown",
    },

    {
      title: "Type",
      dataIndex: "type",
      key: "type",

      render: (type) => {
        const colors = {
          STOCK_IN: "green",
          STOCK_OUT: "red",
          ADJUSTMENT: "orange",
          TRANSFER_IN: "blue",
          TRANSFER_OUT: "purple",
        };

        return (
          <Tag color={colors[type] || "default"}>{type.replace("_", " ")}</Tag>
        );
      },
    },

    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
    },

    {
      title: "Reason",
      dataIndex: "reason",
      key: "reason",

      render: (value) => value || "Ã¢â‚¬â€",
    },

    {
      title: "Reference",
      dataIndex: "reference",
      key: "reference",

      render: (value) => value || "Ã¢â‚¬â€",
    },
  ];

  // =========================
  // RENDER
  // =========================

  return (
    <div className="inventory-page">
      {/* HEADER */}

      <div className="inventory-header">


        <Space wrap>
          <Button
            icon={<HistoryOutlined />}
            onClick={async () => {
              await fetchTransactions();
              setHistoryOpen(true);
            }}
          >
            History
          </Button>

          <Button
            icon={<InboxOutlined />}
            onClick={() => setActionModal("receive")}
          >
            Receive Stock
          </Button>

          <Button
            icon={<WarningOutlined />}
            onClick={() => setActionModal("adjust")}
          >
            Adjust Stock
          </Button>

          <Button
            type="primary"
            icon={<SwapOutlined />}
            onClick={() => setActionModal("transfer")}
          >
            Transfer Stock
          </Button>
        </Space>
      </div>

      {/* STATS */}

      <Row gutter={[16, 16]} className="inventory-stats">
        <Col xs={24} sm={12} lg={6}>
          <Card className="inventory-stat-card">
            <Statistic
              title="Total Stock"
              value={totalStock}
              prefix={<InboxOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="inventory-stat-card">
            <Statistic
              title="Inventory Records"
              value={inventory.length}
              prefix={<AppstoreOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="inventory-stat-card inventory-warning">
            <Statistic
              title="Low Stock"
              value={lowStockCount}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="inventory-stat-card">
            <Statistic title="Healthy Stock" value={healthyCount} />

            <Text type="secondary">{outOfStockCount} out of stock</Text>
          </Card>
        </Col>
      </Row>

      {/* FILTERS */}

      <Card className="inventory-filter-card" title="Filter inventory">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={12} lg={14}>
            <Input
              size="large"
              prefix={<SearchOutlined />}
              placeholder="Search product, SKU, or branch..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </Col>

          <Col xs={24} md={6} lg={5}>
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

          <Col xs={24} md={6} lg={5}>
            <Select
              size="large"
              value={statusFilter}
              onChange={setStatusFilter}
              style={{
                width: "100%",
              }}
            >
              <Select.Option value="all">All Status</Select.Option>

              <Select.Option value="HEALTHY">Healthy</Select.Option>

              <Select.Option value="WARNING">Watch</Select.Option>

              <Select.Option value="LOW">Low Stock</Select.Option>

              <Select.Option value="OUT">Out of Stock</Select.Option>
            </Select>
          </Col>
        </Row>
      </Card>

      {/* TABLE */}

      <Card className="inventory-table-card" title="Inventory records">
        <Table
          columns={columns}
          dataSource={filteredInventory}
          rowKey="_id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
          }}
          locale={{
            emptyText: <Empty description="No inventory records found" />,
          }}
        />
      </Card>

      {/* =========================
          RECEIVE MODAL
      ========================= */}

      <Modal
        title="Receive Stock"
        open={actionModal === "receive"}
        onCancel={() => {
          receiveForm.resetFields();
          setActionModal(null);
        }}
        footer={null}
      >
        <Form form={receiveForm} layout="vertical" onFinish={handleReceive}>
          <Form.Item
            label="Inventory"
            name="inventoryId"
            rules={[
              {
                required: true,
                message: "Select inventory.",
              },
            ]}
          >
            <Select
              showSearch
              placeholder="Select product and branch"
              optionFilterProp="label"
              options={inventory.map((item) => ({
                value: item._id,
                label:
                  `${item.product?.name} - ` +
                  `${item.branch?.code} ` +
                  `(${item.quantity} in stock)`,
              }))}
            />
          </Form.Item>

          <Form.Item
            label="Quantity Received"
            name="quantity"
            rules={[
              {
                required: true,
                message: "Enter quantity.",
              },
            ]}
          >
            <InputNumber
              min={1}
              style={{
                width: "100%",
              }}
              size="large"
            />
          </Form.Item>

          <Form.Item label="Reason" name="reason" initialValue="Stock received">
            <Input placeholder="Reason" />
          </Form.Item>

          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={3} placeholder="Optional notes" />
          </Form.Item>

          <div className="action-modal-footer">
            <Button
              onClick={() => {
                receiveForm.resetFields();
                setActionModal(null);
              }}
            >
              Cancel
            </Button>

            <Button type="primary" htmlType="submit" loading={saving}>
              Receive Stock
            </Button>
          </div>
        </Form>
      </Modal>

      {/* =========================
          ADJUST MODAL
      ========================= */}

      <Modal
        title="Adjust Stock"
        open={actionModal === "adjust"}
        onCancel={() => {
          adjustForm.resetFields();
          setActionModal(null);
        }}
        footer={null}
      >
        <Form form={adjustForm} layout="vertical" onFinish={handleAdjust}>
          <Form.Item
            label="Inventory"
            name="inventoryId"
            rules={[
              {
                required: true,
                message: "Select inventory.",
              },
            ]}
          >
            <Select
              showSearch
              placeholder="Select inventory"
              optionFilterProp="label"
              options={inventory.map((item) => ({
                value: item._id,
                label:
                  `${item.product?.name} - ` +
                  `${item.branch?.code} ` +
                  `(Current: ${item.quantity})`,
              }))}
            />
          </Form.Item>

          <Form.Item
            label="New Quantity"
            name="newQuantity"
            rules={[
              {
                required: true,
                message: "Enter new quantity.",
              },
            ]}
          >
            <InputNumber
              min={0}
              style={{
                width: "100%",
              }}
              size="large"
            />
          </Form.Item>

          <Form.Item
            label="Reason"
            name="reason"
            rules={[
              {
                required: true,
                message: "Select a reason.",
              },
            ]}
          >
            <Select placeholder="Select reason">
              <Select.Option value="Damaged stock">Damaged stock</Select.Option>

              <Select.Option value="Lost stock">Lost stock</Select.Option>

              <Select.Option value="Physical count correction">
                Physical count correction
              </Select.Option>

              <Select.Option value="Expired stock">Expired stock</Select.Option>

              <Select.Option value="Other">Other</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={3} placeholder="Explain the adjustment..." />
          </Form.Item>

          <div className="action-modal-footer">
            <Button
              onClick={() => {
                adjustForm.resetFields();
                setActionModal(null);
              }}
            >
              Cancel
            </Button>

            <Button type="primary" htmlType="submit" loading={saving}>
              Adjust Stock
            </Button>
          </div>
        </Form>
      </Modal>

      {/* =========================
          TRANSFER MODAL
      ========================= */}

      <Modal
        title="Transfer Stock"
        open={actionModal === "transfer"}
        onCancel={() => {
          transferForm.resetFields();
          setActionModal(null);
        }}
        footer={null}
        width={600}
      >
        <Form form={transferForm} layout="vertical" onFinish={handleTransfer}>
          <Form.Item
            label="From Inventory"
            name="fromInventoryId"
            rules={[
              {
                required: true,
                message: "Select source inventory.",
              },
            ]}
          >
            <Select
              showSearch
              placeholder="Select source branch"
              optionFilterProp="label"
              options={inventory.map((item) => ({
                value: item._id,
                label:
                  `${item.product?.name} - ` +
                  `${item.branch?.code} ` +
                  `(Available: ${item.quantity})`,
              }))}
            />
          </Form.Item>

          <div className="transfer-arrow">
            <ArrowRightOutlined />
          </div>

          <Form.Item
            label="To Inventory"
            name="toInventoryId"
            rules={[
              {
                required: true,
                message: "Select destination inventory.",
              },
            ]}
          >
            <Select
              showSearch
              placeholder="Select destination branch"
              optionFilterProp="label"
              options={inventory.map((item) => ({
                value: item._id,
                label:
                  `${item.product?.name} - ` +
                  `${item.branch?.code} ` +
                  `(Current: ${item.quantity})`,
              }))}
            />
          </Form.Item>

          <Form.Item
            label="Quantity"
            name="quantity"
            rules={[
              {
                required: true,
                message: "Enter quantity.",
              },
            ]}
          >
            <InputNumber
              min={1}
              style={{
                width: "100%",
              }}
              size="large"
            />
          </Form.Item>

          <Form.Item
            label="Reason"
            name="reason"
            initialValue="Stock replenishment"
          >
            <Input />
          </Form.Item>

          <Form.Item label="Notes" name="notes">
            <Input.TextArea rows={3} placeholder="Optional transfer notes" />
          </Form.Item>

          <div className="action-modal-footer">
            <Button
              onClick={() => {
                transferForm.resetFields();
                setActionModal(null);
              }}
            >
              Cancel
            </Button>

            <Button type="primary" htmlType="submit" loading={saving}>
              Transfer Stock
            </Button>
          </div>
        </Form>
      </Modal>

      {/* =========================
          TRANSACTION HISTORY
      ========================= */}

      <Modal
        title="Inventory Transaction History"
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        width={1000}
      >
        <Table
          columns={transactionColumns}
          dataSource={transactions}
          rowKey="_id"
          pagination={{
            pageSize: 8,
          }}
          scroll={{
            x: 900,
          }}
        />
      </Modal>
    </div>
  );
};

export default Inventory;
