import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
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
import { useAuth } from "../../context/AuthContext";

import "./Products.css";

const { Title, Text } = Typography;
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const Products = () => {
  const { user } = useAuth();
  const canManageProducts = ["SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_STAFF"].includes(user?.role);
  // =========================
  // STATE
  // =========================

  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [categories, setCategories] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [searchParams] = useSearchParams();
  const focusedSku = searchParams.get("product") || "";
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const imageInputRef = useRef(null);

  const [detailsOpen, setDetailsOpen] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState(null);

  const [form] = Form.useForm();

  useEffect(() => {
    if (!imageFile) {
      setImagePreview("");
      return undefined;
    }
    const previewUrl = URL.createObjectURL(imageFile);
    setImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [imageFile]);

  // =========================
  // FETCH DATA
  // =========================

  const fetchData = async () => {
    try {
      setLoading(true);

      const [productsResponse, inventoryResponse, categoriesResponse] =
        await Promise.all([
          api.get("/products"),
          api.get("/inventory"),
          api.get("/categories"),
        ]);

      setProducts(productsResponse.data);
      setInventory(inventoryResponse.data);
      setCategories(categoriesResponse.data);
    } catch (error) {
      console.error("Products fetch error:", error);

      message.error(
        error.response?.data?.message || "Failed to load products.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (focusedSku) setSearch(focusedSku);
  }, [focusedSku]);

  // =========================
  // GET PRODUCT STOCK
  // =========================

  const getProductStock = (productId) => {
    return inventory
      .filter((item) => item.product?._id === productId)
      .reduce((total, item) => total + item.quantity, 0);
  };

  // =========================
  // FILTER PRODUCTS
  // =========================

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const searchValue = search.toLowerCase().trim();

      const matchesSearch =
        !searchValue ||
        product.name?.toLowerCase().includes(searchValue) ||
        product.sku?.toLowerCase().includes(searchValue) ||
        product.barcode?.toLowerCase().includes(searchValue);

      const matchesCategory =
        categoryFilter === "all" || product.category?._id === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [products, search, categoryFilter]);

  useEffect(() => {
    if (loading || !focusedSku || !filteredProducts.length) return undefined;
    const timer = window.setTimeout(() => {
      document.querySelector(".assistant-focused-row")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [loading, filteredProducts, focusedSku]);



  // =========================
  // ADD PRODUCT
  // =========================

  const handleSubmitProduct = async (values) => {
    try {
      setSaving(true);

      const payload = new FormData();
      Object.entries(values).forEach(([key, value]) => {
        if (value !== undefined && value !== null) payload.append(key, String(value));
      });
      if (imageFile) payload.append("imageFile", imageFile);
      if (removeImage) payload.append("removeImage", "true");

      if (editingProduct) {
        await api.putForm(`/products/${editingProduct._id}`, payload);
        message.success("Product updated successfully.");
      } else {
        await api.postForm("/products", payload);
        message.success("Product added successfully.");
      }

      closeProductModal();

      await fetchData();
    } catch (error) {
      console.error("Save product error:", error);

      message.error(error.response?.data?.message || "Failed to save product.");
    } finally {
      setSaving(false);
    }
  };

  const resetImageSelection = () => {
    setImageFile(null);
    setRemoveImage(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const closeProductModal = () => {
    form.resetFields();
    resetImageSelection();
    setModalOpen(false);
    setEditingProduct(null);
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!IMAGE_TYPES.has(file.type)) {
      message.error("Choose a JPG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
      message.error("Product images must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }
    setImageFile(file);
    setRemoveImage(false);
  };

  const openAddProduct = () => {
    setEditingProduct(null);
    form.resetFields();
    resetImageSelection();
    setModalOpen(true);
  };

  const openEditProduct = (product) => {
    setEditingProduct(product);
    resetImageSelection();
    form.setFieldsValue({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      brand: product.brand,
      category: product.category?._id || product.category,
      description: product.description,
      costPrice: product.costPrice,
      sellingPrice: product.sellingPrice,
      reorderLevel: product.reorderLevel,
      unit: product.unit,
    });
    setModalOpen(true);
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
            {product.image ? <img src={product.image} alt="" /> : <AppstoreOutlined />}
          </div>

          <div>
            <div className="product-name">{product.name}</div>

            <div className="product-brand">{product.brand || "No brand"}</div>

            {product.description && (
              <div className="product-description-preview" title={product.description}>
                {product.description.length > 60
                  ? `${product.description.slice(0, 60)}…`
                  : product.description}
              </div>
            )}
          </div>
        </div>
      ),
    },

    {
      title: "SKU",
      dataIndex: "sku",
      key: "sku",

      render: (sku) => <Text code>{sku}</Text>,
    },

    {
      title: "Category",
      key: "category",

      render: (_, product) => (
        <Tag>{product.category?.name || "Uncategorized"}</Tag>
      ),
    },

    {
      title: "Price",
      key: "price",

      render: (_, product) => (
        <strong>
          &#8369;
          {Number(product.sellingPrice || 0).toLocaleString("en-PH", {
            minimumFractionDigits: 2,
          })}
        </strong>
      ),
    },

    {
      title: "Total Stock",
      key: "stock",

      render: (_, product) => {
        const stock = getProductStock(product._id);

        const reorder = product.reorderLevel || 0;

        let status = "green";

        if (stock <= reorder) {
          status = "red";
        } else if (stock <= reorder * 2) {
          status = "orange";
        }

        return (
          <Tag color={status}>
            {stock} {product.unit || "pcs"}
          </Tag>
        );
      },
    },

    {
      title: "Action",
      key: "action",

      render: (_, product) => (
        <div className="product-actions">
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => handleViewProduct(product)}
          >
            View
          </Button>
          {canManageProducts && (
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => openEditProduct(product)}
            >
              Edit
            </Button>
          )}
        </div>
      ),
    },
  ];

  // =========================
  // SELECTED PRODUCT INVENTORY
  // =========================

  const selectedProductInventory = selectedProduct
    ? inventory.filter((item) => item.product?._id === selectedProduct._id)
    : [];

  // =========================
  // RENDER
  // =========================

  return (
    <div className="products-page">
      {/* =========================
          PAGE HEADER
      ========================= */}

      {/* FILTERS */}

      <Card className="products-filter-card" title="Filter products">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={12} lg={14}>
            <Input
              size="large"
              prefix={<SearchOutlined />}
              placeholder="Search by product name, SKU, or barcode..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </Col>

          <Col xs={24} md={7} lg={6}>
            <Select
              size="large"
              value={categoryFilter}
              onChange={setCategoryFilter}
              style={{ width: "100%" }}
            >
              <Select.Option value="all">All Categories</Select.Option>

              {categories.map((category) => (
                <Select.Option key={category._id} value={category._id}>
                  {category.name}
                </Select.Option>
              ))}
            </Select>
          </Col>

          {canManageProducts && (
            <Col xs={24} md={5} lg={4}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                size="large"
                block
                onClick={openAddProduct}
              >
                Add Product
              </Button>
            </Col>
          )}
        </Row>
      </Card>

      {/* =========================
          PRODUCTS TABLE
      ========================= */}

      <Card className="products-table-card" title="Product catalog">
        <Table
          columns={columns}
          dataSource={filteredProducts}
          rowKey="_id"
          rowClassName={(record) => (record.sku === focusedSku ? "assistant-focused-row" : "")}
          loading={loading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,

            showTotal: (total) => `${total} products`,
          }}
          locale={{
            emptyText: <Empty description="No products found" />,
          }}
        />
      </Card>

      {/* =========================
          ADD PRODUCT MODAL
      ========================= */}

      <Modal
        title={editingProduct ? "Edit Product" : "Add Product"}
        open={modalOpen}
        onCancel={() => {
          if (!saving) {
            closeProductModal();
          }
        }}
        footer={null}
        width={650}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmitProduct}
          requiredMark="optional"
        >
          <Form.Item
            label="Product Name"
            name="name"
            rules={[
              {
                required: true,
                message: "Please enter a product name.",
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
                    message: "Please enter a SKU.",
                  },
                ]}
              >
                <Input placeholder="e.g. BOSCH-GSB120" size="large" />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item label="Barcode" name="barcode">
                <Input placeholder="Barcode" size="large" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Brand" name="brand">
                <Input placeholder="e.g. Bosch" size="large" />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                label="Category"
                name="category"
                rules={[
                  {
                    required: true,
                    message: "Please select a category.",
                  },
                ]}
              >
                <Select placeholder="Select category" size="large">
                  {categories.map((category) => (
                    <Select.Option key={category._id} value={category._id}>
                      {category.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* PRODUCT DESCRIPTION SECTION */}
          <div className="product-form-section">
            <div className="product-form-section-header">
              <label className="product-form-section-title" htmlFor="product-description-input">
                Product Description
              </label>
              <Text type="secondary" className="product-form-section-subtitle">
                Add comprehensive details, materials, and usage guidance displayed to customers on the website.
              </Text>
            </div>
            <Form.Item
              name="description"
              className="product-description-form-item"
            >
              <Input.TextArea
                id="product-description-input"
                rows={4}
                placeholder="Enter detailed product description (e.g., materials, durability, dimensions, usage tips, and key highlights)..."
                maxLength={2000}
                showCount
                allowClear
              />
            </Form.Item>
          </div>

          <div className="product-image-field">
            <label htmlFor="product-image-input">Product image</label>
            <div className="product-image-controls">
              <div className="product-image-preview">
                {(!removeImage && (imagePreview || editingProduct?.image)) ? (
                  <img src={imagePreview || editingProduct.image} alt="Product preview" />
                ) : (
                  <AppstoreOutlined />
                )}
              </div>
              <div className="product-image-options">
                <input
                  id="product-image-input"
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageChange}
                />
                <Text type="secondary">JPG, PNG, or WebP. Up to 5 MB.</Text>
                {(imageFile || (editingProduct?.image && !removeImage)) && (
                  <Button
                    type="link"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => {
                      setImageFile(null);
                      setRemoveImage(Boolean(editingProduct?.image));
                      if (imageInputRef.current) imageInputRef.current.value = "";
                    }}
                  >
                    Remove image
                  </Button>
                )}
              </div>
            </div>
          </div>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="Cost Price"
                name="costPrice"
                rules={[
                  {
                    required: true,
                    message: "Enter cost price.",
                  },
                ]}
              >
                <InputNumber
                  size="large"
                  min={0}
                  prefix={"\u20B1"}
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
                    message: "Enter selling price.",
                  },
                ]}
              >
                <InputNumber
                  size="large"
                  min={0}
                  prefix={"\u20B1"}
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
                message: "Please select a unit.",
              },
            ]}
          >
            <Select size="large">
              <Select.Option value="piece">Piece</Select.Option>

              <Select.Option value="box">Box</Select.Option>

              <Select.Option value="pack">Pack</Select.Option>

              <Select.Option value="meter">Meter</Select.Option>

              <Select.Option value="roll">Roll</Select.Option>

              <Select.Option value="liter">Liter</Select.Option>

              <Select.Option value="kilogram">Kilogram</Select.Option>
            </Select>
          </Form.Item>

          {/* MODAL BUTTONS */}

          <div className="product-modal-footer">
            <Button
              onClick={() => {
                closeProductModal();
              }}
              disabled={saving}
            >
              Cancel
            </Button>

            <Button type="primary" htmlType="submit" loading={saving}>
              {editingProduct ? "Save Changes" : "Add Product"}
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
                {selectedProduct.image ? (
                  <img src={selectedProduct.image} alt="" />
                ) : (
                  <AppstoreOutlined />
                )}
              </div>

              <div>
                <Title level={3}>{selectedProduct.name}</Title>

                <Text type="secondary">{selectedProduct.sku}</Text>
              </div>
            </div>

            {/* PRODUCT INFORMATION */}

            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Card size="small">
                  <Text type="secondary">Cost Price</Text>

                  <div className="detail-value">
                    &#8369;
                    {Number(selectedProduct.costPrice || 0).toLocaleString(
                      "en-PH",
                      {
                        minimumFractionDigits: 2,
                      },
                    )}
                  </div>
                </Card>
              </Col>

              <Col span={8}>
                <Card size="small">
                  <Text type="secondary">Selling Price</Text>

                  <div className="detail-value">
                    &#8369;
                    {Number(selectedProduct.sellingPrice || 0).toLocaleString(
                      "en-PH",
                      {
                        minimumFractionDigits: 2,
                      },
                    )}
                  </div>
                </Card>
              </Col>

              <Col span={8}>
                <Card size="small">
                  <Text type="secondary">Reorder Level</Text>

                  <div className="detail-value">
                    {selectedProduct.reorderLevel || 0}
                  </div>
                </Card>
              </Col>
            </Row>

            {/* PRODUCT DESCRIPTION */}
            <div className="product-details-description">
              <div className="product-details-description-header">
                <Title level={5}>Description</Title>
              </div>
              <div className="detail-description-card">
                {selectedProduct.description ? (
                  <Text className="detail-description-text">
                    {selectedProduct.description}
                  </Text>
                ) : (
                  <Text type="secondary" italic>
                    No description provided for this product.
                  </Text>
                )}
              </div>
            </div>

            {/* BRANCH STOCK */}

            <div className="branch-stock-title">
              <Title level={5}>Branch Stock</Title>
            </div>

            <div className="branch-stock-list">
              {selectedProductInventory.length === 0 ? (
                <Empty description="No branch inventory found" />
              ) : (
                selectedProductInventory.map((item) => {
                  const isLow = item.quantity <= item.reorderLevel;

                  return (
                    <div className="branch-stock-row" key={item._id}>
                      <div>
                        <strong>{item.branch?.name || "Unknown Branch"}</strong>

                        <div>
                          <Text type="secondary">
                            {item.branch?.code || "N/A"}
                          </Text>
                        </div>
                      </div>

                      <div className="branch-stock-right">
                        <Tag color={isLow ? "red" : "green"}>
                          {item.quantity}{" "}
                          {item.product?.unit || selectedProduct.unit || "pcs"}
                        </Tag>

                        <Text type="secondary">
                          Shelf: {item.shelfLocation || "Not assigned"}
                        </Text>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Products;
