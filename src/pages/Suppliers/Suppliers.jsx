import { useEffect, useMemo, useState } from "react";

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  ShopOutlined,
} from "@ant-design/icons";

import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
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

import "./Suppliers.css";

const { Title, Text } = Typography;

const Suppliers = () => {
  const [suppliers, setSuppliers] = useState([]);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);

  const [editingSupplier, setEditingSupplier] = useState(null);

  const [form] = Form.useForm();

  // =========================
  // FETCH
  // =========================

  const fetchSuppliers = async () => {
    try {
      setLoading(true);

      const response = await api.get("/suppliers");

      setSuppliers(response.data);
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to load suppliers.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  // =========================
  // FILTER
  // =========================

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((supplier) => {
      const value = search.toLowerCase().trim();

      const matchesSearch =
        !value ||
        supplier.name?.toLowerCase().includes(value) ||
        supplier.code?.toLowerCase().includes(value) ||
        supplier.contactPerson?.toLowerCase().includes(value) ||
        supplier.email?.toLowerCase().includes(value);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? supplier.isActive : !supplier.isActive);

      return matchesSearch && matchesStatus;
    });
  }, [suppliers, search, statusFilter]);

  // =========================
  // MODAL
  // =========================

  const openAddModal = () => {
    setEditingSupplier(null);

    form.resetFields();

    form.setFieldsValue({
      paymentTerms: "Cash",
    });

    setModalOpen(true);
  };

  const openEditModal = (supplier) => {
    setEditingSupplier(supplier);

    form.setFieldsValue({
      name: supplier.name,
      code: supplier.code,
      contactPerson: supplier.contactPerson,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      paymentTerms: supplier.paymentTerms,
      notes: supplier.notes,
    });

    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;

    form.resetFields();

    setEditingSupplier(null);

    setModalOpen(false);
  };

  // =========================
  // SAVE
  // =========================

  const handleSubmit = async (values) => {
    try {
      setSaving(true);

      if (editingSupplier) {
        await api.put(`/suppliers/${editingSupplier._id}`, values);

        message.success("Supplier updated successfully.");
      } else {
        await api.post("/suppliers", values);

        message.success("Supplier added successfully.");
      }

      closeModal();

      await fetchSuppliers();
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to save supplier.",
      );
    } finally {
      setSaving(false);
    }
  };

  // =========================
  // DEACTIVATE
  // =========================

  const handleDeactivate = (supplier) => {
    Modal.confirm({
      title: "Deactivate this supplier?",
      content: `${supplier.name} will no longer be available for new purchases.`,

      okText: "Deactivate",
      okType: "danger",
      cancelText: "Cancel",

      onOk: async () => {
        try {
          await api.delete(`/suppliers/${supplier._id}`);

          message.success("Supplier deactivated.");

          await fetchSuppliers();
        } catch (error) {
          console.error(error);

          message.error(
            error.response?.data?.message || "Failed to deactivate supplier.",
          );
        }
      },
    });
  };

  // =========================
  // STATISTICS
  // =========================

  const activeCount = suppliers.filter((supplier) => supplier.isActive).length;

  const inactiveCount = suppliers.length - activeCount;

  // =========================
  // TABLE
  // =========================

  const columns = [
    {
      title: "Supplier",
      key: "supplier",

      render: (_, supplier) => (
        <div className="supplier-cell">
          <div className="supplier-icon">
            <ShopOutlined />
          </div>

          <div>
            <div className="supplier-name">{supplier.name}</div>

            <Text type="secondary">{supplier.code}</Text>
          </div>
        </div>
      ),
    },

    {
      title: "Contact Person",
      dataIndex: "contactPerson",

      render: (value) => value || "—",
    },

    {
      title: "Contact",
      key: "contact",

      render: (_, supplier) => (
        <div className="supplier-contact">
          <div>{supplier.phone || "No phone"}</div>

          <Text type="secondary">{supplier.email || "No email"}</Text>
        </div>
      ),
    },

    {
      title: "Payment Terms",
      dataIndex: "paymentTerms",

      render: (value) => <Tag>{value || "Cash"}</Tag>,
    },

    {
      title: "Status",
      dataIndex: "isActive",

      render: (active) =>
        active ? (
          <Tag color="green">Active</Tag>
        ) : (
          <Tag color="red">Inactive</Tag>
        ),
    },

    {
      title: "Actions",
      key: "actions",

      render: (_, supplier) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEditModal(supplier)}
          >
            Edit
          </Button>

          {supplier.isActive && (
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeactivate(supplier)}
            >
              Deactivate
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="suppliers-page">
      {/* HEADER */}

      <div className="suppliers-header">
        <div>
          <Title level={2}>Suppliers</Title>

          <Text type="secondary">Manage suppliers and purchasing partners</Text>
        </div>

        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          onClick={openAddModal}
        >
          Add Supplier
        </Button>
      </div>

      {/* STATISTICS */}

      <Row gutter={[16, 16]} className="supplier-stats">
        <Col xs={24} sm={8}>
          <Card className="supplier-stat-card">
            <Statistic title="Total Suppliers" value={suppliers.length} />
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card className="supplier-stat-card">
            <Statistic title="Active Suppliers" value={activeCount} />
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card className="supplier-stat-card">
            <Statistic title="Inactive Suppliers" value={inactiveCount} />
          </Card>
        </Col>
      </Row>

      {/* FILTERS */}

      <Card className="supplier-filter-card">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={17}>
            <Input
              size="large"
              prefix={<SearchOutlined />}
              placeholder="Search supplier, code, contact, or email..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </Col>

          <Col xs={24} md={7}>
            <Select
              size="large"
              value={statusFilter}
              onChange={setStatusFilter}
              style={{
                width: "100%",
              }}
            >
              <Select.Option value="all">All Suppliers</Select.Option>

              <Select.Option value="active">Active</Select.Option>

              <Select.Option value="inactive">Inactive</Select.Option>
            </Select>
          </Col>
        </Row>
      </Card>

      {/* TABLE */}

      <Card className="supplier-table-card">
        <Table
          columns={columns}
          dataSource={filteredSuppliers}
          rowKey="_id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,

            showTotal: (total) => `${total} suppliers`,
          }}
          locale={{
            emptyText: <Empty description="No suppliers found" />,
          }}
        />
      </Card>

      {/* ADD / EDIT MODAL */}

      <Modal
        title={editingSupplier ? "Edit Supplier" : "Add Supplier"}
        open={modalOpen}
        onCancel={closeModal}
        footer={null}
        width={650}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item
                label="Supplier Name"
                name="name"
                rules={[
                  {
                    required: true,
                    message: "Enter supplier name.",
                  },
                ]}
              >
                <Input size="large" placeholder="ABC Hardware Supply" />
              </Form.Item>
            </Col>

            <Col span={8}>
              <Form.Item
                label="Supplier Code"
                name="code"
                rules={[
                  {
                    required: true,
                    message: "Enter supplier code.",
                  },
                ]}
              >
                <Input
                  size="large"
                  placeholder="SUP-001"
                  disabled={!!editingSupplier}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Contact Person" name="contactPerson">
            <Input size="large" placeholder="Juan Dela Cruz" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Email"
                name="email"
                rules={[
                  {
                    type: "email",
                    message: "Enter a valid email.",
                  },
                ]}
              >
                <Input size="large" placeholder="supplier@example.com" />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item label="Phone" name="phone">
                <Input size="large" placeholder="09171234567" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Address" name="address">
            <Input.TextArea rows={3} placeholder="Supplier address" />
          </Form.Item>

          <Form.Item label="Payment Terms" name="paymentTerms">
            <Select size="large">
              <Select.Option value="Cash">Cash</Select.Option>

              <Select.Option value="15 Days">15 Days</Select.Option>

              <Select.Option value="30 Days">30 Days</Select.Option>

              <Select.Option value="45 Days">45 Days</Select.Option>

              <Select.Option value="60 Days">60 Days</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="Notes" name="notes">
            <Input.TextArea
              rows={3}
              placeholder="Additional supplier notes..."
            />
          </Form.Item>

          <div className="supplier-modal-footer">
            <Button onClick={closeModal} disabled={saving}>
              Cancel
            </Button>

            <Button type="primary" htmlType="submit" loading={saving}>
              {editingSupplier ? "Save Changes" : "Add Supplier"}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default Suppliers;
