import { useEffect, useMemo, useRef, useState } from "react";

import {
  BarcodeOutlined,
  DeleteOutlined,
  HistoryOutlined,
  MinusOutlined,
  PlusOutlined,
  PrinterOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
} from "@ant-design/icons";

import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";

import api from "../../services/api";

import "./POS.css";

const { Title, Text } = Typography;

const PRINTER_SERVER = "http://localhost:5100";

const POS = () => {
  const searchRef = useRef(null);

  // =========================
  // DATA
  // =========================

  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [inventory, setInventory] = useState([]);

  // =========================
  // LOADING
  // =========================

  const [loading, setLoading] = useState(true);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  // =========================
  // BRANCH
  // =========================

  const [selectedBranch, setSelectedBranch] = useState("");

  // =========================
  // SEARCH
  // =========================

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [recentProductIds, setRecentProductIds] = useState([]);
  const [selectedCartProductId, setSelectedCartProductId] = useState(null);

  // =========================
  // CART
  // =========================

  const [cart, setCart] = useState([]);

  // =========================
  // PAYMENT
  // =========================

  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [amountPaid, setAmountPaid] = useState(0);

  // =========================
  // RECEIPT
  // =========================

  const [receipt, setReceipt] = useState(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // =========================
  // PRINTER
  // =========================

  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState("");
  const [printerLoading, setPrinterLoading] = useState(true);
  const [printerOnline, setPrinterOnline] = useState(false);

  // =========================
  // INITIAL DATA
  // =========================

  const fetchInitialData = async () => {
    try {
      setLoading(true);

      const [productsResponse, branchesResponse] = await Promise.all([
        api.get("/products"),
        api.get("/branches"),
      ]);

      setProducts(productsResponse.data.filter((product) => product.isActive));

      const activeBranches = branchesResponse.data.filter(
        (branch) => branch.isActive,
      );

      setBranches(activeBranches);

      if (activeBranches.length > 0) {
        setSelectedBranch(activeBranches[0]._id);
      }
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to load POS data.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  // =========================
  // PRINTER DETECTION
  // =========================

  const fetchPrinters = async () => {
    try {
      setPrinterLoading(true);

      const response = await fetch(`${PRINTER_SERVER}/printers`);

      if (!response.ok) {
        throw new Error("Printer service unavailable.");
      }

      const data = await response.json();

      setPrinters(data.printers || []);

      setSelectedPrinter(data.selectedPrinter || data.defaultPrinter || "");

      setPrinterOnline(true);
    } catch (error) {
      console.error("Printer detection error:", error);

      setPrinters([]);
      setSelectedPrinter("");
      setPrinterOnline(false);
    } finally {
      setPrinterLoading(false);
    }
  };

  useEffect(() => {
    fetchPrinters();
  }, []);

  // =========================
  // PRINTER STATUS
  // =========================

  const checkPrinterStatus = async () => {
    try {
      const response = await fetch(`${PRINTER_SERVER}/status`);

      if (!response.ok) {
        throw new Error("Printer offline.");
      }

      const data = await response.json();

      setPrinterOnline(data.online === true);

      if (data.printer) {
        setSelectedPrinter(data.printer);
      }

      return true;
    } catch (error) {
      console.error("Printer status error:", error);

      setPrinterOnline(false);

      return false;
    }
  };

  // Check printer every 5 seconds
  useEffect(() => {
    let mounted = true;

    const checkStatus = async () => {
      try {
        const response = await fetch(`${PRINTER_SERVER}/status`, {
          cache: "no-store",
        });

        const data = await response.json();

        if (!mounted) return;

        if (response.ok && data.online === true) {
          setPrinterOnline(true);

          if (data.printer) {
            setSelectedPrinter(data.printer);
          }
        } else {
          setPrinterOnline(false);
        }
      } catch (error) {
        if (!mounted) return;

        setPrinterOnline(false);
      }
    };

    // Check immediately
    checkStatus();

    // Then check every 2 seconds
    const interval = setInterval(checkStatus, 2000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // =========================
  // SELECT PRINTER
  // =========================

  const handlePrinterChange = async (printer) => {
    try {
      const response = await fetch(`${PRINTER_SERVER}/printer/select`, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          printer,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to select printer.");
      }

      setSelectedPrinter(printer);
      setPrinterOnline(true);

      message.success(`Printer selected: ${printer}`);
    } catch (error) {
      console.error(error);

      message.error(error.message || "Could not select printer.");

      await checkPrinterStatus();
    }
  };

  // =========================
  // INVENTORY
  // =========================

  const fetchInventory = async (branchId) => {
    if (!branchId) {
      setInventory([]);
      return;
    }

    try {
      setInventoryLoading(true);

      const response = await api.get(`/inventory/branch/${branchId}`);

      setInventory(response.data);
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to load branch inventory.",
      );

      setInventory([]);
    } finally {
      setInventoryLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBranch) {
      fetchInventory(selectedBranch);
    }

    setCart([]);
    setDiscount(0);
    setAmountPaid(0);
  }, [selectedBranch]);

  // =========================
  // INVENTORY MAP
  // =========================

  const inventoryMap = useMemo(() => {
    const map = {};

    inventory.forEach((item) => {
      const productId = item.product?._id || item.product;

      map[productId] = item;
    });

    return map;
  }, [inventory]);

  // =========================
  // SEARCH PRODUCTS
  // =========================

  const categories = useMemo(() => {
    const names = products
      .map((product) => product.category?.name || product.category)
      .filter(Boolean);

    return ["All", ...new Set(names)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const value = search.toLowerCase().trim();

    return products
      .filter((product) => {
        const category = product.category?.name || product.category || "";
        const name = product.name?.toLowerCase() || "";

        const sku = product.sku?.toLowerCase() || "";

        const barcode = product.barcode?.toLowerCase() || "";

        const brand = product.brand?.toLowerCase() || "";

        const matchesSearch =
          !value ||
          name.includes(value) ||
          sku.includes(value) ||
          barcode.includes(value) ||
          brand.includes(value);

        return (
          matchesSearch &&
          (selectedCategory === "All" || category === selectedCategory)
        );
      })
      .slice(0, 30);
  }, [products, search, selectedCategory]);

  // =========================
  // ADD TO CART
  // =========================

  const addToCart = (product) => {
    if (!selectedBranch) {
      message.warning("Select a branch first.");
      return;
    }

    const inventoryItem = inventoryMap[product._id];

    const available = Math.max(
      (inventoryItem?.quantity || 0) - (inventoryItem?.reservedQuantity || 0),
      0,
    );

    if (available <= 0) {
      message.warning(`${product.name} is out of stock in this branch.`);
      return;
    }

    const existing = cart.find((item) => item.product === product._id);

    if (existing) {
      if (existing.quantity >= available) {
        message.warning(`Only ${available} available in this branch.`);
        return;
      }

      setCart(
        cart.map((item) =>
          item.product === product._id
            ? {
                ...item,
                quantity: item.quantity + 1,
                subtotal: (item.quantity + 1) * item.unitPrice,
              }
            : item,
        ),
      );

      setRecentProductIds((ids) =>
        [product._id, ...ids.filter((id) => id !== product._id)].slice(0, 8),
      );
      setSelectedCartProductId(product._id);
      window.setTimeout(() => searchRef.current?.focus(), 0);

      return;
    }

    setCart([
      ...cart,
      {
        product: product._id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        unitPrice: Number(product.sellingPrice),
        quantity: 1,
        subtotal: Number(product.sellingPrice),
        available,
      },
    ]);
    setRecentProductIds((ids) =>
      [product._id, ...ids.filter((id) => id !== product._id)].slice(0, 8),
    );
    setSelectedCartProductId(product._id);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  const handleProductSearch = (value) => {
    const scannedValue = value.trim().toLowerCase();

    if (!scannedValue) return;

    const exactProduct = products.find((product) =>
      [product.barcode, product.sku]
        .filter(Boolean)
        .some((code) => code.toLowerCase() === scannedValue),
    );

    if (exactProduct) {
      addToCart(exactProduct);
      setSearch("");
      window.setTimeout(() => searchRef.current?.focus(), 0);
      return;
    }

    message.warning("No product matches that barcode or SKU.");
  };

  // =========================
  // QUANTITY
  // =========================

  const applyQuantity = (productId, quantity) => {
    const cartItem = cart.find((item) => item.product === productId);

    if (!cartItem) return;

    const newQuantity = Number(quantity);

    if (!newQuantity || newQuantity <= 0) {
      removeFromCart(productId);
      return;
    }

    if (newQuantity > cartItem.available) {
      message.warning(`Only ${cartItem.available} available.`);
      return;
    }

    setCart(
      cart.map((item) =>
        item.product === productId
          ? {
              ...item,
              quantity: newQuantity,
              subtotal: newQuantity * item.unitPrice,
            }
          : item,
      ),
    );
  };

  const updateQuantity = (productId, quantity) => {
    const cartItem = cart.find((item) => item.product === productId);
    const newQuantity = Number(quantity);

    if (cartItem && newQuantity > 10 && newQuantity > cartItem.quantity) {
      Modal.confirm({
        title: "Confirm large quantity",
        content: `Set ${cartItem.name} to ${newQuantity} units?`,
        okText: "Confirm quantity",
        onOk: () => applyQuantity(productId, newQuantity),
      });
      return;
    }

    applyQuantity(productId, newQuantity);
  };

  const increaseQuantity = (productId) => {
    const item = cart.find((cartItem) => cartItem.product === productId);

    if (!item) return;

    updateQuantity(productId, item.quantity + 1);
  };

  const decreaseQuantity = (productId) => {
    const item = cart.find((cartItem) => cartItem.product === productId);

    if (!item) return;

    updateQuantity(productId, item.quantity - 1);
  };

  // =========================
  // REMOVE
  // =========================

  const removeFromCart = (productId) => {
    setCart(cart.filter((item) => item.product !== productId));
    setSelectedCartProductId((selected) =>
      selected === productId ? null : selected,
    );
  };

  // =========================
  // TOTALS
  // =========================

  const subtotal = useMemo(() => {
    return cart.reduce((total, item) => total + item.subtotal, 0);
  }, [cart]);

  const discountAmount = Math.min(Math.max(Number(discount) || 0, 0), subtotal);

  const total = Math.max(subtotal - discountAmount, 0);

  const change = Math.max((Number(amountPaid) || 0) - total, 0);

  const totalItems = cart.reduce((total, item) => total + item.quantity, 0);

  // =========================
  // PAYMENT
  // =========================

  const handlePaymentMethodChange = (value) => {
    setPaymentMethod(value);

    if (value !== "CASH") {
      setAmountPaid(total);
    } else {
      setAmountPaid(0);
    }
  };

  useEffect(() => {
    if (paymentMethod !== "CASH") {
      setAmountPaid(total);
    }
  }, [total, paymentMethod]);

  // =========================
  // PRINT RECEIPT
  // =========================

  const printReceipt = async (sale) => {
    try {
      const response = await fetch(`${PRINTER_SERVER}/print`, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          branch: sale.branch?.name || "Hardware Store",

          receiptNumber: sale.receiptNumber,

          date: new Date(sale.createdAt).toLocaleString("en-PH"),

          cashier: sale.cashier?.name || "Cashier",

          items:
            sale.items?.map((item) => ({
              name: item.product?.name || "Product",

              quantity: item.quantity,

              price: item.unitPrice,
            })) || [],

          subtotal: sale.subtotal,

          discount: sale.discount,

          total: sale.totalAmount,

          paymentMethod: sale.paymentMethod,

          amountPaid: sale.amountPaid,

          change: sale.changeAmount,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || "Printing failed.");
      }

      setPrinterOnline(true);

      message.success("Receipt printed successfully.");

      return true;
    } catch (error) {
      console.error("Printer error:", error);

      setPrinterOnline(false);

      message.warning("Sale completed, but the receipt could not be printed.");

      return false;
    }
  };

  // =========================
  // COMPLETE SALE
  // =========================

  const completeSale = async () => {
    if (!selectedBranch) {
      message.error("Select a branch.");
      return;
    }

    if (cart.length === 0) {
      message.error("Add products to the cart first.");
      return;
    }

    if (paymentMethod === "CASH" && Number(amountPaid) < total) {
      message.error("Amount paid is less than the total.");
      return;
    }

    try {
      setProcessing(true);

      const payload = {
        branch: selectedBranch,

        items: cart.map((item) => ({
          product: item.product,
          quantity: item.quantity,
        })),

        discount: discountAmount,

        paymentMethod,

        amountPaid: Number(amountPaid),
      };

      // =========================
      // CREATE SALE
      // =========================

      const response = await api.post("/sales", payload);

      const sale = response.data.sale;

      if (!sale) {
        throw new Error("Sale was created but no sale data was returned.");
      }

      // =========================
      // REFRESH INVENTORY
      // =========================

      await fetchInventory(selectedBranch);

      // =========================
      // RECEIPT MODAL
      // =========================

      setReceipt(sale);
      setReceiptOpen(true);

      // =========================
      // CLEAR CART
      // =========================

      setCart([]);
      setDiscount(0);
      setAmountPaid(0);
      setPaymentMethod("CASH");

      // =========================
      // PRINT
      // =========================

      await printReceipt(sale);

      message.success("Sale completed successfully.");
    } catch (error) {
      console.error("Sale error:", error);

      message.error(
        error.response?.data?.message ||
          error.message ||
          "Failed to complete sale.",
      );
    } finally {
      setProcessing(false);
    }
  };

  // =========================
  // CLEAR CART
  // =========================

  const clearCart = () => {
    if (cart.length === 0) {
      return;
    }

    Modal.confirm({
      title: "Clear cart?",

      content: "All items currently in the cart will be removed.",

      okText: "Clear Cart",

      okType: "danger",

      onOk: () => {
        setCart([]);
        setDiscount(0);
        setAmountPaid(0);
      },
    });
  };

  const handleDiscountChange = (value) => {
    const nextDiscount = Number(value) || 0;

    if (
      subtotal > 0 &&
      nextDiscount > subtotal * 0.1 &&
      nextDiscount > discount
    ) {
      Modal.confirm({
        title: "Confirm discount",
        content: `This discount is over 10% of the sale (₱${subtotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}).`,
        okText: "Apply discount",
        onOk: () => setDiscount(nextDiscount),
      });
      return;
    }

    setDiscount(nextDiscount);
  };

  const startNewSale = () => {
    setReceiptOpen(false);
    setReceipt(null);
    setSearch("");
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  useEffect(() => {
    const isTyping = (target) =>
      ["INPUT", "TEXTAREA"].includes(target?.tagName) ||
      target?.isContentEditable;

    const handleShortcut = (event) => {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }

      if (event.key === "Escape") {
        setSearch("");
        setReceiptOpen(false);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }

      if (isTyping(event.target)) return;

      if (event.key === "F4") handlePaymentMethodChange("CASH");
      if (event.key === "F5") handlePaymentMethodChange("GCASH");
      if (event.key === "F6") handlePaymentMethodChange("CARD");
      if (event.key === "F9" && cart.length > 0 && !processing) completeSale();

      if (selectedCartProductId && event.key === "+") {
        event.preventDefault();
        increaseQuantity(selectedCartProductId);
      }
      if (selectedCartProductId && event.key === "-") {
        event.preventDefault();
        decreaseQuantity(selectedCartProductId);
      }
      if (selectedCartProductId && event.key === "Delete") {
        event.preventDefault();
        removeFromCart(selectedCartProductId);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [cart, processing, selectedCartProductId, total]);

  // =========================
  // TEST PRINT
  // =========================

  const testPrint = async () => {
    try {
      const response = await fetch(`${PRINTER_SERVER}/print`, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          branch:
            branches.find((branch) => branch._id === selectedBranch)?.name ||
            "Hardware Store",

          receiptNumber: "TEST-000001",

          date: new Date().toLocaleString("en-PH"),

          cashier: "Test Cashier",

          items: [
            {
              name: "Printer Test",
              quantity: 1,
              price: 1,
            },
          ],

          subtotal: 1,
          discount: 0,
          total: 1,

          paymentMethod: "CASH",

          amountPaid: 1,
          change: 0,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || "Test print failed.");
      }

      setPrinterOnline(true);

      message.success("Test receipt printed successfully.");
    } catch (error) {
      console.error(error);

      setPrinterOnline(false);

      message.error(error.message || "Printer test failed.");
    }
  };

  // =========================
  // REPRINT
  // =========================

  const reprintReceipt = async () => {
    if (!receipt) return;

    await printReceipt(receipt);
  };

  // =========================
  // LOADING
  // =========================

  if (loading) {
    return (
      <div className="pos-loading">
        <Spin size="large" />

        <Text type="secondary">Loading POS...</Text>
      </div>
    );
  }

  // =========================
  // UI
  // =========================

  return (
    <div className="pos-page">
      {/* =========================
          HEADER
      ========================= */}

      <div className="pos-header">
        <div className="pos-title">
          <Title level={2}>Point of Sale</Title>

          <Text type="secondary">Hardware Store Sales</Text>
        </div>

        <div className="pos-header-controls">
          {/* BRANCH */}

          <div className="pos-branch">
            <Text type="secondary">Branch</Text>

            <Select
              value={selectedBranch || undefined}
              onChange={setSelectedBranch}
              size="large"
              loading={inventoryLoading}
              style={{
                minWidth: 260,
              }}
              options={branches.map((branch) => ({
                value: branch._id,

                label: `${branch.code} — ${branch.name}`,
              }))}
            />
          </div>

          {/* PRINTER */}

          <div className="pos-printer">
            <div
              className={`printer-status ${
                printerOnline ? "printer-connected" : "printer-disconnected"
              }`}
            >
              <span className="printer-status-dot">●</span>

              <div>
                <strong>Receipt Printer</strong>

                <div className="printer-status-text">
                  {printerOnline
                    ? selectedPrinter || "Connected"
                    : "Printer Offline"}
                </div>
              </div>
            </div>

            <Select
              value={selectedPrinter || undefined}
              placeholder={
                printerLoading ? "Detecting printer..." : "Select printer"
              }
              loading={printerLoading}
              disabled={printers.length === 0}
              style={{
                minWidth: 220,
              }}
              onChange={handlePrinterChange}
              options={printers.map((printer) => ({
                value: printer.name,

                label: (
                  <span>
                    {printer.name}

                    {printer.isDefault && (
                      <Tag
                        color="blue"
                        style={{
                          marginLeft: 8,
                        }}
                      >
                        Default
                      </Tag>
                    )}
                  </span>
                ),
              }))}
            />

            <Button
              size="large"
              icon={<PrinterOutlined />}
              onClick={testPrint}
              disabled={!printerOnline}
            >
              Test
            </Button>

            <Button
              size="large"
              onClick={fetchPrinters}
              loading={printerLoading}
            >
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* =========================
          MAIN
      ========================= */}

      <Row gutter={[20, 20]} className="pos-main">
        {/* PRODUCTS */}

        <Col xs={24} lg={15}>
          <Card
            className="pos-products-card"
            title={
              <div className="pos-card-title">
                <ShoppingCartOutlined />

                <span>Products</span>
              </div>
            }
          >
            <Input
              ref={searchRef}
              size="large"
              prefix={<SearchOutlined />}
              suffix={<BarcodeOutlined />}
              placeholder="Search product, SKU, brand, or barcode..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onPressEnter={(event) => handleProductSearch(event.target.value)}
              allowClear
              autoFocus
            />

            <div className="pos-product-tools">
              <Select
                value={selectedCategory}
                onChange={setSelectedCategory}
                options={categories.map((category) => ({
                  value: category,
                  label: category,
                }))}
                aria-label="Filter products by category"
                className="category-filter"
              />
              {recentProductIds.length > 0 && (
                <div
                  className="recent-products"
                  aria-label="Recently added products"
                >
                  <HistoryOutlined />
                  {recentProductIds.slice(0, 4).map((id) => {
                    const product = products.find((item) => item._id === id);
                    return product ? (
                      <Button
                        key={id}
                        size="small"
                        onClick={() => addToCart(product)}
                      >
                        {product.name}
                      </Button>
                    ) : null;
                  })}
                </div>
              )}
            </div>

            <div className="pos-product-count">
              <Text type="secondary">
                {filteredProducts.length} products shown
              </Text>

              {inventoryLoading && <Spin size="small" />}
            </div>

            <div className="pos-products-grid">
              {filteredProducts.map((product) => {
                const stock = inventoryMap[product._id]?.quantity || 0;

                const inCart = cart.find(
                  (item) => item.product === product._id,
                );

                return (
                  <Card
                    key={product._id}
                    className={`pos-product-card ${
                      stock <= 0 ? "out-of-stock" : ""
                    }`}
                    hoverable={stock > 0}
                    role="button"
                    tabIndex={stock > 0 ? 0 : -1}
                    onClick={() => {
                      if (stock > 0) {
                        addToCart(product);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        stock > 0 &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        addToCart(product);
                      }
                    }}
                  >
                    <div className="product-top">
                      <Tag>{product.brand || "Hardware"}</Tag>

                      {stock <= 0 ? (
                        <Tag color="red">Out of Stock</Tag>
                      ) : stock <= 5 ? (
                        <Tag color="orange">Low Stock</Tag>
                      ) : null}
                    </div>

                    <div className="product-name">{product.name}</div>

                    <Text type="secondary">{product.sku}</Text>

                    <div className="product-price">
                      ₱
                      {Number(product.sellingPrice).toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                      })}
                    </div>

                    <div className="product-bottom">
                      <Text type="secondary">
                        {product.unit ? `Per ${product.unit}` : "Per item"} ·
                        Stock: <strong>{stock}</strong>
                      </Text>

                      {inCart && (
                        <Tag color="blue">In cart: {inCart.quantity}</Tag>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>

            {filteredProducts.length === 0 && (
              <Empty description="No products found" className="pos-empty" />
            )}
          </Card>
        </Col>

        {/* CART */}

        <Col xs={24} lg={9}>
          <Card
            className="pos-cart-card"
            title={
              <div className="cart-header">
                <div className="pos-card-title">
                  <ShoppingCartOutlined />

                  <span>Current Sale</span>

                  <Tag color="blue">{totalItems}</Tag>
                </div>

                <Button
                  danger
                  type="text"
                  onClick={clearCart}
                  disabled={cart.length === 0}
                >
                  Clear
                </Button>
              </div>
            }
          >
            {cart.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Cart is empty"
                className="cart-empty"
              />
            ) : (
              <div className="cart-items">
                {cart.map((item) => (
                  <div
                    className="cart-item"
                    onClick={() => setSelectedCartProductId(item.product)}
                    data-selected={selectedCartProductId === item.product}
                    key={item.product}
                  >
                    <div className="cart-item-main">
                      <div className="cart-item-name">{item.name}</div>

                      <Text type="secondary">{item.sku}</Text>

                      <div className="cart-item-price">
                        ₱
                        {Number(item.unitPrice).toLocaleString("en-PH", {
                          minimumFractionDigits: 2,
                        })}{" "}
                        / {item.unit}
                      </div>
                    </div>

                    <div className="cart-item-controls">
                      <Space.Compact>
                        <Button
                          icon={<MinusOutlined />}
                          onClick={() => decreaseQuantity(item.product)}
                        />

                        <InputNumber
                          min={1}
                          max={item.available}
                          value={item.quantity}
                          onChange={(value) =>
                            updateQuantity(item.product, value)
                          }
                          controls={false}
                          className="cart-quantity"
                        />

                        <Button
                          icon={<PlusOutlined />}
                          onClick={() => increaseQuantity(item.product)}
                        />
                      </Space.Compact>

                      <Button
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        onClick={() => removeFromCart(item.product)}
                      />
                    </div>

                    <div className="cart-item-subtotal">
                      ₱
                      {Number(item.subtotal).toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* SUMMARY */}

            <div className="pos-summary">
              <div className="summary-row">
                <Text>Subtotal</Text>

                <strong>
                  ₱
                  {subtotal.toLocaleString("en-PH", {
                    minimumFractionDigits: 2,
                  })}
                </strong>
              </div>

              <div className="summary-row">
                <Text>Discount</Text>

                <InputNumber
                  min={0}
                  max={subtotal}
                  precision={2}
                  prefix="₱"
                  value={discount}
                  onChange={(value) => handleDiscountChange(value)}
                  size="small"
                  style={{
                    width: 140,
                  }}
                />
              </div>

              <div className="summary-total">
                <span>TOTAL</span>

                <strong>
                  ₱
                  {total.toLocaleString("en-PH", {
                    minimumFractionDigits: 2,
                  })}
                </strong>
              </div>
            </div>

            {/* PAYMENT */}

            <div className="payment-section">
              <Text strong>Payment Method</Text>

              <Radio.Group
                value={paymentMethod}
                onChange={(event) =>
                  handlePaymentMethodChange(event.target.value)
                }
                className="payment-methods"
              >
                <Radio.Button value="CASH">Cash</Radio.Button>

                <Radio.Button value="GCASH">GCash</Radio.Button>

                <Radio.Button value="CARD">Card</Radio.Button>
              </Radio.Group>

              <div className="amount-row">
                <div>
                  <Text type="secondary">Amount Paid</Text>

                  <InputNumber
                    size="large"
                    min={0}
                    precision={2}
                    prefix="₱"
                    value={amountPaid}
                    onChange={(value) => setAmountPaid(value || 0)}
                    disabled={paymentMethod !== "CASH"}
                    style={{
                      width: "100%",
                    }}
                  />

                  {paymentMethod === "CASH" && (
                    <div
                      className="quick-tender"
                      aria-label="Quick cash amount"
                    >
                      <Button onClick={() => setAmountPaid(total)}>
                        Exact amount
                      </Button>
                      {[100, 200, 500, 1000].map((amount) => (
                        <Button
                          key={amount}
                          onClick={() => setAmountPaid(amount)}
                        >
                          ₱{amount.toLocaleString("en-PH")}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <Text type="secondary">Change</Text>

                  <div
                    className={`change-display ${amountPaid >= total && total > 0 ? "change-ready" : ""}`}
                  >
                    ₱
                    {change.toLocaleString("en-PH", {
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>
            </div>

            <Button
              type="primary"
              size="large"
              block
              className="complete-sale-button"
              loading={processing}
              disabled={
                cart.length === 0 ||
                !selectedBranch ||
                (paymentMethod === "CASH" && amountPaid < total)
              }
              onClick={completeSale}
            >
              {cart.length === 0
                ? "ADD ITEMS TO START"
                : paymentMethod === "CASH" && amountPaid < total
                  ? "ENTER SUFFICIENT CASH"
                  : `PAY ₱${total.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`}
            </Button>

            <Text className="checkout-help" type="secondary">
              F2 Search · F4 Cash · F5 GCash · F6 Card · F9 Pay
            </Text>
          </Card>
        </Col>
      </Row>

      {/* RECEIPT */}

      <Modal
        title="Sale Completed"
        open={receiptOpen}
        onCancel={() => startNewSale()}
        footer={[
          <Button
            key="reprint"
            icon={<PrinterOutlined />}
            onClick={reprintReceipt}
            disabled={!printerOnline}
          >
            Reprint
          </Button>,

          <Button key="new-sale" type="primary" onClick={startNewSale}>
            New Sale
          </Button>,
        ]}
        width={500}
      >
        {receipt && (
          <div className="receipt">
            {Number(receipt.changeAmount) > 0 && (
              <div className="receipt-change-hero">
                <span>CHANGE DUE</span>
                <strong>
                  ₱
                  {Number(receipt.changeAmount).toLocaleString("en-PH", {
                    minimumFractionDigits: 2,
                  })}
                </strong>
              </div>
            )}

            <div className="receipt-header">
              <Title level={3}>HARDWARE STORE</Title>

              <Text>{receipt.branch?.name}</Text>

              <Text type="secondary">Official Sales Receipt</Text>
            </div>

            <div className="receipt-info">
              <div>
                <span>Receipt</span>

                <strong>{receipt.receiptNumber}</strong>
              </div>

              <div>
                <span>Date</span>

                <strong>
                  {new Date(receipt.createdAt).toLocaleString("en-PH")}
                </strong>
              </div>
            </div>

            <div className="receipt-info">
              <div>
                <span>Cashier</span>

                <strong>{receipt.cashier?.name || "Cashier"}</strong>
              </div>
            </div>

            <div className="receipt-items">
              {receipt.items?.map((item) => (
                <div className="receipt-item" key={item._id}>
                  <div>
                    <strong>{item.product?.name}</strong>

                    <Text type="secondary">
                      {item.quantity} × ₱
                      {Number(item.unitPrice).toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                      })}
                    </Text>
                  </div>

                  <strong>
                    ₱
                    {Number(item.subtotal).toLocaleString("en-PH", {
                      minimumFractionDigits: 2,
                    })}
                  </strong>
                </div>
              ))}
            </div>

            <div className="receipt-total-row">
              <span>Subtotal</span>

              <span>
                ₱
                {Number(receipt.subtotal).toLocaleString("en-PH", {
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>

            <div className="receipt-total-row">
              <span>Discount</span>

              <span>
                ₱
                {Number(receipt.discount).toLocaleString("en-PH", {
                  minimumFractionDigits: 2,
                })}
              </span>
            </div>

            <div className="receipt-grand-total">
              <span>TOTAL</span>

              <strong>
                ₱
                {Number(receipt.totalAmount).toLocaleString("en-PH", {
                  minimumFractionDigits: 2,
                })}
              </strong>
            </div>

            <div className="receipt-payment">
              <div>
                <span>Payment</span>

                <strong>{receipt.paymentMethod}</strong>
              </div>

              <div>
                <span>Amount Paid</span>

                <strong>
                  ₱
                  {Number(receipt.amountPaid).toLocaleString("en-PH", {
                    minimumFractionDigits: 2,
                  })}
                </strong>
              </div>

              <div>
                <span>Change</span>

                <strong>
                  ₱
                  {Number(receipt.changeAmount).toLocaleString("en-PH", {
                    minimumFractionDigits: 2,
                  })}
                </strong>
              </div>
            </div>

            <div className="receipt-footer">
              Thank you for your purchase!
              <br />
              Please come again.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default POS;
