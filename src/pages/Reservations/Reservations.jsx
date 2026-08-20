import { useEffect, useMemo, useState } from "react";

import {
  ClockCircleOutlined,
  EnvironmentOutlined,
  LockOutlined,
  PlusOutlined,
  ShopOutlined,
  UserOutlined,
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

import "./Reservations.css";

const { Title, Text } = Typography;

const Reservations = () => {
  const [inventory, setInventory] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [now, setNow] = useState(Date.now());
  const [form] = Form.useForm();

  const fetchData = async () => {
    try {
      setLoading(true);
      const [inventoryResponse, reservationResponse] = await Promise.all([
        api.get("/inventory"),
        api.get("/reservations"),
      ]);
      setInventory(inventoryResponse.data || []);
      setReservations(reservationResponse.data || []);
    } catch (error) {
      message.error(
        error.response?.data?.message || "Failed to load availability.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const products = useMemo(() => {
    const map = new Map();
    inventory.forEach((item) => {
      if (item.product?._id && !map.has(item.product._id))
        map.set(item.product._id, item.product);
    });
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [inventory]);

  const availableRows = useMemo(() => {
    const value = search.toLowerCase().trim();
    return inventory.filter((item) => {
      const productName = item.product?.name?.toLowerCase() || "";
      const sku = item.product?.sku?.toLowerCase() || "";
      const branchName = item.branch?.name?.toLowerCase() || "";
      return (
        !value ||
        productName.includes(value) ||
        sku.includes(value) ||
        branchName.includes(value)
      );
    });
  }, [inventory, search]);

  const activeReservations = reservations.filter((item) =>
    ["ACTIVE", "READY_FOR_PICKUP"].includes(item.status),
  );
  const reservedUnits = activeReservations.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const readyCount = reservations.filter(
    (item) => item.status === "READY_FOR_PICKUP",
  ).length;

  const formatRemaining = (expiresAt) => {
    const seconds = Math.max(
      0,
      Math.floor((new Date(expiresAt).getTime() - now) / 1000),
    );
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return hours > 0
      ? `${hours}h ${String(minutes).padStart(2, "0")}m`
      : `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  };

  const createReservation = async (values) => {
    try {
      setSaving(true);
      await api.post("/reservations", {
        ...values,
        expiresAt: new Date(
          Date.now() + values.holdMinutes * 60 * 1000,
        ).toISOString(),
      });
      message.success("Product reserved successfully.");
      form.resetFields();
      setModalOpen(false);
      await fetchData();
    } catch (error) {
      message.error(
        error.response?.data?.message || "Failed to create reservation.",
      );
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      await api.patch(`/reservations/${id}/status`, { status });
      message.success(
        `Reservation marked ${status.replaceAll("_", " ").toLowerCase()}.`,
      );
      await fetchData();
    } catch (error) {
      message.error(
        error.response?.data?.message || "Failed to update reservation.",
      );
    }
  };

  const availabilityColumns = [
    {
      title: "Product",
      key: "product",
      render: (_, item) => (
        <div>
          <strong>{item.product?.name}</strong>
          <div className="reservation-muted">{item.product?.sku}</div>
        </div>
      ),
    },
    {
      title: "Branch",
      key: "branch",
      render: (_, item) => (
        <Space>
          <ShopOutlined />
          <span>{item.branch?.name}</span>
          <Tag>{item.branch?.code}</Tag>
        </Space>
      ),
    },
    {
      title: "On hand",
      dataIndex: "quantity",
      key: "quantity",
      render: (value, item) => `${value} ${item.product?.unit || "pcs"}`,
    },
    {
      title: "Available",
      key: "available",
      render: (_, item) => {
        const available = Math.max(
          item.quantity - (item.reservedQuantity || 0),
          0,
        );
        return (
          <strong
            className={
              available <= item.reorderLevel
                ? "reservation-low"
                : "reservation-available"
            }
          >
            {available}
          </strong>
        );
      },
    },
    {
      title: "Status",
      key: "status",
      render: (_, item) => {
        const available = Math.max(
          item.quantity - (item.reservedQuantity || 0),
          0,
        );
        if (available === 0) return <Tag color="red">Unavailable</Tag>;
        if (available <= item.reorderLevel)
          return <Tag color="orange">Low stock</Tag>;
        if (item.reservedQuantity > 0)
          return <Tag color="blue">Partially reserved</Tag>;
        return <Tag color="green">Available</Tag>;
      },
    },
  ];

  const reservationColumns = [
    {
      title: "Reservation",
      key: "reservation",
      render: (_, item) => (
        <div>
          <strong>{item.reservationNumber}</strong>
          <div className="reservation-muted">
            {item.product?.name} x {item.quantity}
          </div>
        </div>
      ),
    },
    {
      title: "Customer",
      key: "customer",
      render: (_, item) => (
        <div>
          <span>{item.customerName}</span>
          <div className="reservation-muted">
            {item.customerPhone || "No phone number"}
          </div>
        </div>
      ),
    },
    {
      title: "Branch",
      key: "branch",
      render: (_, item) => item.branch?.name || "-",
    },
    {
      title: "State",
      dataIndex: "status",
      key: "status",
      render: (status) => {
        const colors = {
          ACTIVE: "blue",
          READY_FOR_PICKUP: "green",
          COMPLETED: "default",
          CANCELLED: "red",
          EXPIRED: "orange",
        };
        return <Tag color={colors[status]}>{status.replaceAll("_", " ")}</Tag>;
      },
    },
    {
      title: "Hold expires",
      key: "expiresAt",
      render: (_, item) =>
        item.status === "ACTIVE" ? (
          <Text
            type={
              new Date(item.expiresAt).getTime() - now < 15 * 60 * 1000
                ? "danger"
                : undefined
            }
          >
            <ClockCircleOutlined /> {formatRemaining(item.expiresAt)}
          </Text>
        ) : (
          <Text type="secondary">
            {new Date(item.expiresAt).toLocaleString()}
          </Text>
        ),
    },
    {
      title: "Actions",
      key: "actions",
      render: (_, item) => {
        if (item.status === "ACTIVE") {
          return (
            <Space wrap>
              <Button
                size="small"
                onClick={() => updateStatus(item._id, "READY_FOR_PICKUP")}
              >
                Ready for pickup
              </Button>
              <Button
                size="small"
                danger
                onClick={() => updateStatus(item._id, "CANCELLED")}
              >
                Release
              </Button>
            </Space>
          );
        }
        if (item.status === "READY_FOR_PICKUP") {
          return (
            <Space wrap>
              <Button
                type="primary"
                size="small"
                onClick={() => updateStatus(item._id, "COMPLETED")}
              >
                Complete pickup
              </Button>
              <Button
                size="small"
                danger
                onClick={() => updateStatus(item._id, "CANCELLED")}
              >
                Cancel
              </Button>
            </Space>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div className="reservations-page">
      <div className="reservations-header">
        <div>
          <Title level={2}>Branch Availability</Title>
          <Text type="secondary">
            Find stock across branches and hold products for pickup.
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
        >
          New reservation
        </Button>
      </div>

      <Row gutter={[16, 16]} className="reservations-stats">
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Active holds"
              value={activeReservations.length}
              prefix={<LockOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Reserved units"
              value={reservedUnits}
              prefix={<EnvironmentOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="Ready for pickup"
              value={readyCount}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card className="reservations-panel" title="Live stock by branch">
        <Space wrap className="reservations-filters">
          <Input
            allowClear
            prefix={<EnvironmentOutlined />}
            placeholder="Search product, SKU, or branch"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Space>
        <Table
          rowKey="_id"
          loading={loading}
          columns={availabilityColumns}
          dataSource={availableRows}
          scroll={{ x: 850 }}
          pagination={{ pageSize: 8 }}
          locale={{
            emptyText: <Empty description="No branch inventory found" />,
          }}
        />
      </Card>

      <Card className="reservations-panel" title="Reservation queue">
        <Select
          className="reservation-status-filter"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "ALL", label: "All reservations" },
            { value: "ACTIVE", label: "Active" },
            { value: "READY_FOR_PICKUP", label: "Ready for pickup" },
            { value: "COMPLETED", label: "Completed" },
            { value: "CANCELLED", label: "Cancelled" },
            { value: "EXPIRED", label: "Expired" },
          ]}
        />
        <Table
          rowKey="_id"
          loading={loading}
          columns={reservationColumns}
          dataSource={
            statusFilter === "ALL"
              ? reservations
              : reservations.filter((item) => item.status === statusFilter)
          }
          scroll={{ x: 1050 }}
          pagination={{ pageSize: 8 }}
          locale={{ emptyText: <Empty description="No reservations yet" /> }}
        />
      </Card>

      <Modal
        title="Reserve product for pickup"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={createReservation}
          initialValues={{ quantity: 1, holdMinutes: 120 }}
        >
          <Form.Item
            name="branch"
            label="Pickup branch"
            rules={[{ required: true, message: "Select a branch." }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={Array.from(
                new Map(
                  inventory.map((item) => [item.branch?._id, item.branch]),
                ).values(),
              ).map((branch) => ({
                value: branch?._id,
                label: `${branch?.name} (${branch?.code})`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="product"
            label="Product"
            rules={[{ required: true, message: "Select a product." }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={products.map((product) => ({
                value: product._id,
                label: `${product.name} (${product.sku})`,
              }))}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="quantity"
                label="Quantity"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} className="full-width" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="holdMinutes"
                label="Hold duration (minutes)"
                rules={[{ required: true }]}
              >
                <InputNumber min={15} max={10080} className="full-width" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="customerName"
            label="Customer name"
            rules={[{ required: true, message: "Enter the customer name." }]}
          >
            <Input placeholder="e.g. Maria Santos" />
          </Form.Item>
          <Form.Item name="customerPhone" label="Customer phone">
            <Input placeholder="Optional contact number" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={saving}
            block
            icon={<LockOutlined />}
          >
            Hold available stock
          </Button>
        </Form>
      </Modal>
    </div>
  );
};

export default Reservations;
