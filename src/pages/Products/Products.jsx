import { useEffect, useMemo, useState } from "react";

import {
  AppstoreOutlined,
  EyeOutlined,
  PlusOutlined,
  SearchOutlined,
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
  Table,
  Tag,
  Typography,
  message,
} from "antd";

import api from "../../services/api";

import "./Products.css";

const { Title, Text } = Typography;

const Products = () => {
  // =========================
  // STATE
  // =========================

  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [categories, setCategories] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] =
    useState("all");

  const [modalOpen, setModalOpen] =
    useState(false);

  const [detailsOpen, setDetailsOpen] =
    useState(false);

  const [selectedProduct, setSelectedProduct] =
    useState(null);

  const [form] = Form.useForm();

  // =========================
  // FETCH DATA
  // =========================

  const fetchData = async () => {
    try {
      setLoading(true);

      const [
        productsResponse,
        inventoryResponse,
        categoriesResponse,
      ] = await Promise.all([
        api.get("/products"),
        api.get("/inventory"),
        api.get("/categories"),
      ]);

      setProducts(productsResponse.data);
      setInventory(inventoryResponse.data);
      setCategories(categoriesResponse.data);
    } catch (error) {
      console.error(
        "Products fetch error:",
        error
      );

      message.error(
        error.response?.data?.message ||
          "Failed to load products."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // =========================
  // GET PRODUCT STOCK
  // =========================

  const getProductStock = (productId) => {
    return inventory
      .filter(
        (item) =>
          item.product?._id === productId
      )
      .reduce(
        (total, item) =>
          total + item.quantity,
        0
      );
  };

  // =========================
  // FILTER PRODUCTS
  // =========================

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const searchValue =
        search.toLowerCase().trim();

      const matchesSearch =
        !searchValue ||
        product.name
          ?.toLowerCase()
          .includes(searchValue) ||
        product.sku
          ?.toLowerCase()
          .includes(searchValue) ||
        product.barcode
          ?.toLowerCase()
          .includes(searchValue);

      const matchesCategory =
        categoryFilter === "all" ||
        product.category?._id ===
          categoryFilter;

      return (
        matchesSearch &&
        matchesCategory
      );
    });
  }, [
    products,
    search,
    categoryFilter,
  ]);

  // =========================
  // ADD PRODUCT
  // =========================

  const handleAddProduct = async (values) => {
    try {
      setSaving(true);

      await api.post("/products", values);

      message.success(
        "Product added successfully."
      );

      form.resetFields();

      setModalOpen(false);

      await fetchData();
    } catch (error) {
      console.error(
        "Add product error:",
        error
      );

      message.error(
        error.response?.data?.message ||
          "Failed to add product."
      );
    } finally {
      setSaving(false);
    }
  };

  // =========================
  // OPEN PRODUCT DETAILS
  // =========================

  const handleViewProduct = (product) => {
    setSelectedProduct(product);
    setDetailsOpen(true);
  };

  // =========================
  // PRODUCT TABLE
  // =========================

  const columns = [
    {
      title: "Product",
      key: "product",

      render: (_, product) => (
        <div className="product-cell">

          <div className="product-icon">
            <AppstoreOutlined />
          </div>

          <div>
            <div className="product-name">
              {product.name}
            </div>

            <div className="product-brand">
              {product.brand ||
                "No brand"}
            </div>
          </div>

        </div>
      ),
    },

    {
      title: "SKU",
      dataIndex: "sku",
      key: "sku",

      render: (sku) => (
        <Text code>
          {sku}
        </Text>
      ),
    },

    {
      title: "Category",
      key: "category",

      render: (_, product) => (
        <Tag>
          {product.category?.name ||
            "Uncategorized"}
        </Tag>
      ),
    },

    {
      title: "Price",
      key: "price",

      render: (_, product) => (
        <strong>
          ₱
          {Number(
            product.sellingPrice || 0
          ).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
          })}
        </strong>
      ),
    },

    {
      title: "Total Stock",
      key: "stock",

      render: (_, product) => {
        const stock =
          getProductStock(
            product._id
          );

        const reorder =
          product.reorderLevel || 0;

        let status = "green";

        if (stock <= reorder) {
          status = "red";
        } else if (
          stock <= reorder * 2
        ) {
          status = "orange";
        }

        return (
          <Tag color={status}>
            {stock}{" "}
            {product.unit || "pcs"}
          </Tag>
        );
      },
    },

    {
      title: "Action",
      key: "action",

      render: (_, product) => (
        <Button
          type="text"
          icon={<EyeOutlined />}
          onClick={() =>
            handleViewProduct(product)
          }
        >
          View
        </Button>
      ),
    },
  ];

  // =========================
  // SELECTED PRODUCT INVENTORY
  // =========================

  const selectedProductInventory =
    selectedProduct
      ? inventory.filter(
          (item) =>
            item.product?._id ===
            selectedProduct._id
        )
      : [];

  // =========================
  // RENDER
  // =========================

  return (
    <div className="products-page">

      {/* =========================
          PAGE HEADER
      ========================= */}

      <div className="products-header">

        <div>
          <Title level={2}>
            Products
          </Title>

          <Text type="secondary">
            Manage your hardware
            product catalog
          </Text>
        </div>

        <Button
          type="primary"
          icon={<PlusOutlined />}
          size="large"
          onClick={() =>
            setModalOpen(true)
          }
        >
          Add Product
        </Button>

      </div>

      {/* =========================
          FILTERS
      ========================= */}

      <Card className="products-filter-card">

        <Row gutter={[12, 12]}>

          <Col
            xs={24}
            md={14}
            lg={16}
          >
            <Input
              size="large"
              prefix={
                <SearchOutlined />
              }
              placeholder="Search by product name, SKU, or barcode..."
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              allowClear
            />
          </Col>

          <Col
            xs={24}
            md={10}
            lg={8}
          >
            <Select
              size="large"
              value={categoryFilter}
              onChange={setCategoryFilter}
              style={{
                width: "100%",
              }}
            >
              <Select.Option value="all">
                All Categories
              </Select.Option>

              {categories.map(
                (category) => (
                  <Select.Option
                    key={category._id}
                    value={category._id}
                  >
                    {category.name}
                  </Select.Option>
                )
              )}
            </Select>
          </Col>

        </Row>

      </Card>

      {/* =========================
          PRODUCTS TABLE
      ========================= */}

      <Card className="products-table-card">

        <Table
          columns={columns}
          dataSource={
            filteredProducts
          }
          rowKey="_id"
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,

            showTotal: (total) =>
              `${total} products`,
          }}
          locale={{
            emptyText: (
              <Empty
                description="No products found"
              />
            ),
          }}
        />

      </Card>

      {/* =========================
          ADD PRODUCT MODAL
      ========================= */}

      <Modal
        title="Add Product"
        open={modalOpen}
        onCancel={() => {
          if (!saving) {
            form.resetFields();
            setModalOpen(false);
          }
        }}
        footer={null}
        width={650}
        destroyOnClose
      >

        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddProduct}
          requiredMark="optional"
        >

          <Form.Item
            label="Product Name"
            name="name"
            rules={[
              {
                required: true,
                message:
                  "Please enter a product name.",
              },
            ]}
          >
            <Input
              placeholder="e.g. Bosch GSB 120-LI Cordless Drill"
              size="large"
            />
          </Form.Item>

          <Row gutter={16}>

            <Col span={12}>
              <Form.Item
                label="SKU"
                name="sku"
                rules={[
                  {
                    required: true,
                    message:
                      "Please enter a SKU.",
                  },
                ]}
              >
                <Input
                  placeholder="e.g. BOSCH-GSB120"
                  size="large"
                />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                label="Barcode"
                name="barcode"
              >
                <Input
                  placeholder="Barcode"
                  size="large"
                />
              </Form.Item>
            </Col>

          </Row>

          <Row gutter={16}>

            <Col span={12}>
              <Form.Item
                label="Brand"
                name="brand"
              >
                <Input
                  placeholder="e.g. Bosch"
                  size="large"
                />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                label="Category"
                name="category"
                rules={[
                  {
                    required: true,
                    message:
                      "Please select a category.",
                  },
                ]}
              >
                <Select
                  placeholder="Select category"
                  size="large"
                >
                  {categories.map(
                    (category) => (
                      <Select.Option
                        key={category._id}
                        value={category._id}
                      >
                        {category.name}
                      </Select.Option>
                    )
                  )}
                </Select>
              </Form.Item>
            </Col>

          </Row>

          <Form.Item
            label="Description"
            name="description"
          >
            <Input.TextArea
              rows={3}
              placeholder="Product description..."
            />
          </Form.Item>

          <Row gutter={16}>

            <Col span={8}>
              <Form.Item
                label="Cost Price"
                name="costPrice"
                rules={[
                  {
                    required: true,
                    message:
                      "Enter cost price.",
                  },
                ]}
              >
                <InputNumber
                  size="large"
                  min={0}
                  prefix="₱"
                  style={{
                    width: "100%",
                  }}
                />
              </Form.Item>
            </Col>

            <Col span={8}>
              <Form.Item
                label="Selling Price"
                name="sellingPrice"
                rules={[
                  {
                    required: true,
                    message:
                      "Enter selling price.",
                  },
                ]}
              >
                <InputNumber
                  size="large"
                  min={0}
                  prefix="₱"
                  style={{
                    width: "100%",
                  }}
                />
              </Form.Item>
            </Col>

            <Col span={8}>
              <Form.Item
                label="Reorder Level"
                name="reorderLevel"
                initialValue={5}
              >
                <InputNumber
                  size="large"
                  min={0}
                  style={{
                    width: "100%",
                  }}
                />
              </Form.Item>
            </Col>

          </Row>

          <Form.Item
            label="Unit"
            name="unit"
            initialValue="piece"
            rules={[
              {
                required: true,
                message:
                  "Please select a unit.",
              },
            ]}
          >
            <Select size="large">

              <Select.Option value="piece">
                Piece
              </Select.Option>

              <Select.Option value="box">
                Box
              </Select.Option>

              <Select.Option value="pack">
                Pack
              </Select.Option>

              <Select.Option value="meter">
                Meter
              </Select.Option>

              <Select.Option value="roll">
                Roll
              </Select.Option>

              <Select.Option value="liter">
                Liter
              </Select.Option>

              <Select.Option value="kg">
                Kilogram
              </Select.Option>

            </Select>
          </Form.Item>

          {/* MODAL BUTTONS */}

          <div className="product-modal-footer">

            <Button
              onClick={() => {
                form.resetFields();
                setModalOpen(false);
              }}
              disabled={saving}
            >
              Cancel
            </Button>

            <Button
              type="primary"
              htmlType="submit"
              loading={saving}
            >
              Add Product
            </Button>

          </div>

        </Form>

      </Modal>

      {/* =========================
          PRODUCT DETAILS MODAL
      ========================= */}

      <Modal
        title="Product Details"
        open={detailsOpen}
        onCancel={() => {
          setDetailsOpen(false);
          setSelectedProduct(null);
        }}
        footer={null}
        width={700}
      >

        {selectedProduct && (
          <div className="product-details">

            {/* PRODUCT HEADER */}

            <div className="product-details-header">

              <div className="product-details-icon">
                <AppstoreOutlined />
              </div>

              <div>

                <Title level={3}>
                  {selectedProduct.name}
                </Title>

                <Text type="secondary">
                  {selectedProduct.sku}
                </Text>

              </div>

            </div>

            {/* PRODUCT INFORMATION */}

            <Row gutter={[16, 16]}>

              <Col span={8}>
                <Card size="small">

                  <Text type="secondary">
                    Cost Price
                  </Text>

                  <div className="detail-value">
                    ₱
                    {Number(
                      selectedProduct.costPrice ||
                        0
                    ).toLocaleString(
                      "en-PH",
                      {
                        minimumFractionDigits: 2,
                      }
                    )}
                  </div>

                </Card>
              </Col>

              <Col span={8}>
                <Card size="small">

                  <Text type="secondary">
                    Selling Price
                  </Text>

                  <div className="detail-value">
                    ₱
                    {Number(
                      selectedProduct.sellingPrice ||
                        0
                    ).toLocaleString(
                      "en-PH",
                      {
                        minimumFractionDigits: 2,
                      }
                    )}
                  </div>

                </Card>
              </Col>

              <Col span={8}>
                <Card size="small">

                  <Text type="secondary">
                    Reorder Level
                  </Text>

                  <div className="detail-value">
                    {selectedProduct.reorderLevel ||
                      0}
                  </div>

                </Card>
              </Col>

            </Row>

            {/* BRANCH STOCK */}

            <div className="branch-stock-title">

              <Title level={5}>
                Branch Stock
              </Title>

            </div>

            <div className="branch-stock-list">

              {selectedProductInventory.length ===
              0 ? (
                <Empty
                  description="No branch inventory found"
                />
              ) : (
                selectedProductInventory.map(
                  (item) => {

                    const isLow =
                      item.quantity <=
                      item.reorderLevel;

                    return (
                      <div
                        className="branch-stock-row"
                        key={item._id}
                      >

                        <div>

                          <strong>
                            {item.branch?.name ||
                              "Unknown Branch"}
                          </strong>

                          <div>
                            <Text type="secondary">
                              {item.branch?.code ||
                                "N/A"}
                            </Text>
                          </div>

                        </div>

                        <div className="branch-stock-right">

                          <Tag
                            color={
                              isLow
                                ? "red"
                                : "green"
                            }
                          >
                            {item.quantity}{" "}
                            {item.product
                              ?.unit ||
                              selectedProduct.unit ||
                              "pcs"}
                          </Tag>

                          <Text type="secondary">
                            Shelf:{" "}
                            {item.shelfLocation ||
                              "Not assigned"}
                          </Text>

                        </div>

                      </div>
                    );
                  }
                )
              )}

            </div>

          </div>
        )}

      </Modal>

    </div>
  );
};

export default Products;