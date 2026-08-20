import { useEffect, useMemo, useState } from "react";

import {
  EyeOutlined,
  FileTextOutlined,
  PlusOutlined,
  SearchOutlined,
  SendOutlined,
  InboxOutlined,
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

import "./PurchaseOrders.css";

const { Title, Text } = Typography;

const PurchaseOrders = () => {
  const [orders, setOrders] = useState([]);

  const [suppliers, setSuppliers] = useState([]);

  const [branches, setBranches] = useState([]);

  const [products, setProducts] = useState([]);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("all");

  const [createOpen, setCreateOpen] = useState(false);

  const [viewOpen, setViewOpen] = useState(false);

  const [receiveOpen, setReceiveOpen] = useState(false);

  const [selectedOrder, setSelectedOrder] = useState(null);

  const [createForm] = Form.useForm();

  const [receiveForm] = Form.useForm();

  // =========================
  // FETCH DATA
  // =========================

  const fetchData = async () => {
    try {
      setLoading(true);

      const [
        ordersResponse,
        suppliersResponse,
        branchesResponse,
        productsResponse,
      ] = await Promise.all([
        api.get("/purchase-orders"),
        api.get("/suppliers"),
        api.get("/branches"),
        api.get("/products"),
      ]);

      setOrders(ordersResponse.data);

      setSuppliers(
        suppliersResponse.data.filter((supplier) => supplier.isActive),
      );

      setBranches(branchesResponse.data.filter((branch) => branch.isActive));

      setProducts(productsResponse.data.filter((product) => product.isActive));
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to load purchase order data.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // =========================
  // FILTER
  // =========================

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const value = search.toLowerCase().trim();

      const poNumber = order.poNumber?.toLowerCase() || "";

      const supplier = order.supplier?.name?.toLowerCase() || "";

      const branch = order.branch?.code?.toLowerCase() || "";

      const matchesSearch =
        !value ||
        poNumber.includes(value) ||
        supplier.includes(value) ||
        branch.includes(value);

      const matchesStatus =
        statusFilter === "all" || order.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [orders, search, statusFilter]);

  // =========================
  // STATISTICS
  // =========================

  const draftCount = orders.filter((order) => order.status === "DRAFT").length;

  const orderedCount = orders.filter(
    (order) => order.status === "ORDERED",
  ).length;

  const receivingCount = orders.filter(
    (order) => order.status === "PARTIALLY_RECEIVED",
  ).length;

  const receivedCount = orders.filter(
    (order) => order.status === "RECEIVED",
  ).length;

  // =========================
  // CREATE PO
  // =========================

  const openCreateModal = () => {
    createForm.resetFields();

    createForm.setFieldsValue({
      items: [
        {
          product: undefined,
          quantity: 1,
          unitCost: 0,
        },
      ],
    });

    setCreateOpen(true);
  };

  const closeCreateModal = () => {
    if (saving) return;

    createForm.resetFields();

    setCreateOpen(false);
  };

  const handleCreate = async (values) => {
    try {
      setSaving(true);

      await api.post("/purchase-orders", values);

      message.success("Purchase order created successfully.");

      closeCreateModal();

      await fetchData();
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to create purchase order.",
      );
    } finally {
      setSaving(false);
    }
  };

  // =========================
  // STATUS
  // =========================

  const updateStatus = async (order, status) => {
    try {
      await api.put(`/purchase-orders/${order._id}/status`, {
        status,
      });

      message.success(`Purchase order marked as ${status}.`);

      await fetchData();
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to update purchase order.",
      );
    }
  };

  // =========================
  // VIEW
  // =========================

  const openView = (order) => {
    setSelectedOrder(order);

    setViewOpen(true);
  };

  // =========================
  // RECEIVE
  // =========================

  const openReceive = (order) => {
    setSelectedOrder(order);

    const remainingItems = order.items
      .filter((item) => item.receivedQuantity < item.quantity)
      .map((item) => ({
        itemId: item._id,
        quantity: item.quantity - item.receivedQuantity,
      }));

    receiveForm.setFieldsValue({
      items: remainingItems,
    });

    setReceiveOpen(true);
  };

  const closeReceiveModal = () => {
    if (saving) return;

    receiveForm.resetFields();

    setSelectedOrder(null);

    setReceiveOpen(false);
  };

  const handleReceive = async (values) => {
    try {
      setSaving(true);

      const items = (values.items || [])
        .filter((item) => Number(item.quantity) > 0)
        .map((item) => ({
          itemId: item.itemId,
          quantity: Number(item.quantity),
        }));

      if (items.length === 0) {
        message.error("Enter at least one received quantity.");

        setSaving(false);

        return;
      }

      await api.post(`/purchase-orders/${selectedOrder._id}/receive`, {
        items,
      });

      message.success("Purchase order received successfully.");

      closeReceiveModal();

      await fetchData();
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to receive purchase order.",
      );
    } finally {
      setSaving(false);
    }
  };

  // =========================
  // STATUS DISPLAY
  // =========================

  const getStatusTag = (status) => {
    const config = {
      DRAFT: {
        color: "default",
        label: "Draft",
      },

      ORDERED: {
        color: "blue",
        label: "Ordered",
      },

      PARTIALLY_RECEIVED: {
        color: "orange",
        label: "Partially Received",
      },

      RECEIVED: {
        color: "green",
        label: "Received",
      },

      CANCELLED: {
        color: "red",
        label: "Cancelled",
      },
    };

    const value = config[status] || config.DRAFT;

    return <Tag color={value.color}>{value.label}</Tag>;
  };

  // =========================
  // TABLE
  // =========================

  const columns = [
    {
      title: "PO Number",
      dataIndex: "poNumber",
      key: "poNumber",

      render: (value) => <strong>{value}</strong>,
    },

    {
      title: "Supplier",
      key: "supplier",

      render: (_, order) => (
        <div>
          <div className="po-supplier">{order.supplier?.name}</div>

          <Text type="secondary">{order.supplier?.code}</Text>
        </div>
      ),
    },

    {
      title: "Branch",
      key: "branch",

      render: (_, order) => <Tag>{order.branch?.code}</Tag>,
    },

    {
      title: "Items",
      key: "items",

      render: (_, order) => order.items?.length || 0,
    },

    {
      title: "Total",
      dataIndex: "totalAmount",
      key: "total",

      render: (value) =>
        `₱${Number(value).toLocaleString("en-PH", {
          minimumFractionDigits: 2,
        })}`,
    },

    {
      title: "Status",
      dataIndex: "status",
      key: "status",

      render: (status) => getStatusTag(status),
    },

    {
      title: "Created",
      dataIndex: "createdAt",
      key: "created",

      render: (value) => new Date(value).toLocaleDateString("en-PH"),
    },

    {
      title: "Actions",
      key: "actions",

      render: (_, order) => (
        <Space>
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => openView(order)}
          >
            View
          </Button>

          {order.status === "DRAFT" && (
            <Button
              type="text"
              icon={<SendOutlined />}
              onClick={() => updateStatus(order, "ORDERED")}
            >
              Order
            </Button>
          )}

          {(order.status === "ORDERED" ||
            order.status === "PARTIALLY_RECEIVED") && (
            <Button
              type="primary"
              ghost
              icon={<InboxOutlined />}
              onClick={() => openReceive(order)}
            >
              Receive
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="purchase-orders-page">
      {/* =========================
          HEADER
      ========================= */}

      <div className="purchase-orders-header">
        <div>
          <Title level={2}>Purchase Orders</Title>

          <Text type="secondary">
            Manage supplier orders and incoming stock
          </Text>
        </div>

        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          onClick={openCreateModal}
        >
          Create Purchase Order
        </Button>
      </div>

      {/* =========================
          STATISTICS
      ========================= */}

      <Row gutter={[16, 16]} className="po-stats">
        <Col xs={24} sm={12} lg={6}>
          <Card className="po-stat-card">
            <Statistic title="Draft" value={draftCount} />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="po-stat-card">
            <Statistic title="Ordered" value={orderedCount} />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="po-stat-card">
            <Statistic title="Receiving" value={receivingCount} />
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card className="po-stat-card">
            <Statistic title="Received" value={receivedCount} />
          </Card>
        </Col>
      </Row>

      {/* =========================
          FILTERS
      ========================= */}

      <Card className="po-filter-card">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={16}>
            <Input
              size="large"
              prefix={<SearchOutlined />}
              placeholder="Search PO number, supplier, or branch..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </Col>

          <Col xs={24} md={8}>
            <Select
              size="large"
              value={statusFilter}
              onChange={setStatusFilter}
              style={{
                width: "100%",
              }}
            >
              <Select.Option value="all">All Statuses</Select.Option>

              <Select.Option value="DRAFT">Draft</Select.Option>

              <Select.Option value="ORDERED">Ordered</Select.Option>

              <Select.Option value="PARTIALLY_RECEIVED">
                Partially Received
              </Select.Option>

              <Select.Option value="RECEIVED">Received</Select.Option>

              <Select.Option value="CANCELLED">Cancelled</Select.Option>
            </Select>
          </Col>
        </Row>
      </Card>

      {/* =========================
          TABLE
      ========================= */}

      <Card className="po-table-card">
        <Table
          columns={columns}
          dataSource={filteredOrders}
          rowKey="_id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,

            showTotal: (total) => `${total} purchase orders`,
          }}
          locale={{
            emptyText: <Empty description="No purchase orders found" />,
          }}
        />
      </Card>

      {/* =========================
          CREATE PURCHASE ORDER
      ========================= */}

      <Modal
        title="Create Purchase Order"
        open={createOpen}
        onCancel={closeCreateModal}
        footer={null}
        width={900}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Supplier"
                name="supplier"
                rules={[
                  {
                    required: true,
                    message: "Select a supplier.",
                  },
                ]}
              >
                <Select
                  size="large"
                  placeholder="Select supplier"
                  showSearch
                  optionFilterProp="label"
                  options={suppliers.map((supplier) => ({
                    value: supplier._id,
                    label: `${supplier.code} - ${supplier.name}`,
                  }))}
                />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                label="Receiving Branch"
                name="branch"
                rules={[
                  {
                    required: true,
                    message: "Select a branch.",
                  },
                ]}
              >
                <Select
                  size="large"
                  placeholder="Select branch"
                  showSearch
                  optionFilterProp="label"
                  options={branches.map((branch) => ({
                    value: branch._id,
                    label: `${branch.code} - ${branch.name}`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Expected Delivery Date" name="expectedDeliveryDate">
            <Input type="date" size="large" />
          </Form.Item>

          <Title level={5}>Order Items</Title>

          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field, index) => (
                  <Card key={field.key} size="small" className="po-item-card">
                    <Row gutter={12} align="bottom">
                      <Col flex="1">
                        <Form.Item
                          {...field}
                          label={index === 0 ? "Product" : ""}
                          name={[field.name, "product"]}
                          rules={[
                            {
                              required: true,
                              message: "Select product.",
                            },
                          ]}
                        >
                          <Select
                            placeholder="Select product"
                            showSearch
                            optionFilterProp="label"
                            options={products.map((product) => ({
                              value: product._id,
                              label: `${product.sku} - ${product.name}`,
                            }))}
                          />
                        </Form.Item>
                      </Col>

                      <Col flex="130px">
                        <Form.Item
                          {...field}
                          label={index === 0 ? "Quantity" : ""}
                          name={[field.name, "quantity"]}
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
                          />
                        </Form.Item>
                      </Col>

                      <Col flex="160px">
                        <Form.Item
                          {...field}
                          label={index === 0 ? "Unit Cost" : ""}
                          name={[field.name, "unitCost"]}
                          rules={[
                            {
                              required: true,
                              message: "Enter cost.",
                            },
                          ]}
                        >
                          <InputNumber
                            min={0}
                            precision={2}
                            prefix="₱"
                            style={{
                              width: "100%",
                            }}
                          />
                        </Form.Item>
                      </Col>

                      <Col flex="50px">
                        <Button
                          danger
                          type="text"
                          disabled={fields.length === 1}
                          onClick={() => remove(field.name)}
                        >
                          ×
                        </Button>
                      </Col>
                    </Row>
                  </Card>
                ))}

                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() =>
                    add({
                      quantity: 1,
                      unitCost: 0,
                    })
                  }
                >
                  Add Product
                </Button>
              </>
            )}
          </Form.List>

          <Form.Item
            label="Notes"
            name="notes"
            style={{
              marginTop: 20,
            }}
          >
            <Input.TextArea rows={3} placeholder="Purchase order notes..." />
          </Form.Item>

          <div className="po-modal-footer">
            <Button onClick={closeCreateModal} disabled={saving}>
              Cancel
            </Button>

            <Button
              type="primary"
              htmlType="submit"
              loading={saving}
              icon={<FileTextOutlined />}
            >
              Create Purchase Order
            </Button>
          </div>
        </Form>
      </Modal>

      {/* =========================
          VIEW PURCHASE ORDER
      ========================= */}

      <Modal
        title={
          selectedOrder
            ? `Purchase Order ${selectedOrder.poNumber}`
            : "Purchase Order"
        }
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={null}
        width={850}
      >
        {selectedOrder && (
          <>
            <Row gutter={[16, 16]} className="po-details">
              <Col span={8}>
                <Text type="secondary">Supplier</Text>

                <div>
                  <strong>{selectedOrder.supplier?.name}</strong>
                </div>
              </Col>

              <Col span={8}>
                <Text type="secondary">Branch</Text>

                <div>
                  <strong>{selectedOrder.branch?.code}</strong>
                </div>
              </Col>

              <Col span={8}>
                <Text type="secondary">Status</Text>

                <div>{getStatusTag(selectedOrder.status)}</div>
              </Col>
            </Row>

            <Table
              className="po-details-table"
              pagination={false}
              rowKey="_id"
              dataSource={selectedOrder.items}
              columns={[
                {
                  title: "Product",
                  key: "product",

                  render: (_, item) => item.product?.name,
                },

                {
                  title: "SKU",
                  key: "sku",

                  render: (_, item) => item.product?.sku,
                },

                {
                  title: "Ordered",
                  dataIndex: "quantity",
                },

                {
                  title: "Received",
                  dataIndex: "receivedQuantity",
                },

                {
                  title: "Unit Cost",
                  dataIndex: "unitCost",

                  render: (value) =>
                    `₱${Number(value).toLocaleString("en-PH", {
                      minimumFractionDigits: 2,
                    })}`,
                },

                {
                  title: "Subtotal",
                  dataIndex: "subtotal",

                  render: (value) =>
                    `₱${Number(value).toLocaleString("en-PH", {
                      minimumFractionDigits: 2,
                    })}`,
                },
              ]}
            />

            <div className="po-total">
              <Text>Total</Text>

              <strong>
                ₱
                {Number(selectedOrder.totalAmount).toLocaleString("en-PH", {
                  minimumFractionDigits: 2,
                })}
              </strong>
            </div>
          </>
        )}
      </Modal>

      {/* =========================
          RECEIVE PURCHASE ORDER
      ========================= */}

      <Modal
        title={
          selectedOrder
            ? `Receive ${selectedOrder.poNumber}`
            : "Receive Purchase Order"
        }
        open={receiveOpen}
        onCancel={closeReceiveModal}
        footer={null}
        width={700}
      >
        {selectedOrder && (
          <Form form={receiveForm} layout="vertical" onFinish={handleReceive}>
            <div className="receive-info">
              <Text type="secondary">Receiving branch</Text>

              <strong>
                {selectedOrder.branch?.code} — {selectedOrder.branch?.name}
              </strong>
            </div>

            <Form.List name="items">
              {(fields) => (
                <>
                  {fields.map((field, index) => {
                    const orderItem = selectedOrder.items.filter(
                      (item) => item.receivedQuantity < item.quantity,
                    )[index];

                    if (!orderItem) {
                      return null;
                    }

                    const remaining =
                      orderItem.quantity - orderItem.receivedQuantity;

                    return (
                      <Card
                        key={field.key}
                        size="small"
                        className="receive-item"
                      >
                        <div className="receive-item-info">
                          <div>
                            <strong>{orderItem.product?.name}</strong>

                            <Text type="secondary">
                              {orderItem.product?.sku}
                            </Text>
                          </div>

                          <Tag>Remaining: {remaining}</Tag>
                        </div>

                        {/* ITEM ID */}
                        <Form.Item
                          {...field}
                          name={[field.name, "itemId"]}
                          initialValue={orderItem._id}
                          hidden
                        >
                          <Input />
                        </Form.Item>

                        {/* RECEIVE QUANTITY */}
                        <Form.Item
                          {...field}
                          label="Receive Quantity"
                          name={[field.name, "quantity"]}
                          rules={[
                            {
                              required: true,
                              message: "Enter receive quantity.",
                            },
                          ]}
                        >
                          <InputNumber
                            min={0}
                            max={remaining}
                            style={{
                              width: "100%",
                            }}
                          />
                        </Form.Item>
                      </Card>
                    );
                  })}
                </>
              )}
            </Form.List>

            <div className="po-modal-footer">
              <Button onClick={closeReceiveModal} disabled={saving}>
                Cancel
              </Button>

              <Button
                type="primary"
                htmlType="submit"
                loading={saving}
                icon={<InboxOutlined />}
              >
                Receive Stock
              </Button>
            </div>
          </Form>
        )}
      </Modal>
    </div>
  );
};

export default PurchaseOrders;
