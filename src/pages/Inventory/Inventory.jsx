import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  AppstoreOutlined,
  ClearOutlined,
  DownloadOutlined,
  UploadOutlined,
  InboxOutlined,
  SearchOutlined,
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
  Radio,
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
import { useAuth } from "../../context/AuthContext";
import { createRequestKey } from "../../utils/idempotency";

import "./Inventory.css";

const { Text } = Typography;

const Inventory = () => {
  const { user } = useAuth();
  const canManageStock = ["SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_STAFF"].includes(user?.role);
  const [searchParams] = useSearchParams();
  const focusedSku = searchParams.get("product") || "";
  const [inventory, setInventory] = useState([]);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [branchFilter, setBranchFilter] = useState("all");

  const [statusFilter, setStatusFilter] = useState("all");

  const [stockUpdateOpen, setStockUpdateOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importFileName, setImportFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importPreview, setImportPreview] = useState([]);

  const [transactions, setTransactions] = useState([]);

  const [historyOpen, setHistoryOpen] = useState(false);

  const [stockUpdateForm] = Form.useForm();
  const stockUpdateType = Form.useWatch("updateType", stockUpdateForm) || "delivery";
  const selectedInventoryId = Form.useWatch("inventoryId", stockUpdateForm);
  const selectedInventory = inventory.find((item) => item._id === selectedInventoryId);
  const reservedQuantity = selectedInventory?.reservedQuantity || 0;
  const isCorrection = stockUpdateType === "correction";
  const stockRequestRef = useRef(null);

  useEffect(() => {
    stockRequestRef.current = null;
  }, [stockUpdateOpen]);

  const postStockAction = (path, values) => {
    const signature = JSON.stringify({ path, values });
    if (stockRequestRef.current?.signature !== signature) {
      stockRequestRef.current = { signature, key: createRequestKey() };
    }
    return api.post(path, values, {
      headers: { "Idempotency-Key": stockRequestRef.current.key },
    });
  };

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
    const quantity = Math.max((item.quantity || 0) - (item.reservedQuantity || 0), 0);

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

  const clearFilters = () => {
    setSearch("");
    setBranchFilter("all");
    setStatusFilter("all");
  };

  const exportInventory = () => {
    const rows = [
      ["Product", "SKU", "Branch", "Branch Code", "On Hand", "Reserved", "Available", "Reorder Level", "Shelf", "Status"],
      ...filteredInventory.map((item) => [
        item.product?.name || "Unknown product",
        item.product?.sku || "",
        item.branch?.name || "Unknown branch",
        item.branch?.code || "",
        item.quantity || 0,
        item.reservedQuantity || 0,
        Math.max(Number(item.quantity || 0) - Number(item.reservedQuantity || 0), 0),
        item.reorderLevel ?? item.product?.reorderLevel ?? 0,
        item.shelfLocation || "",
        getStockStatus(item),
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "inventory-export.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadImportTemplate = () => {
    const csv = [
      ["Product", "Branch", "Quantity", "Reorder Level", "Shelf Location"],
      ["Common Nail 2 inch", "BR-001", "100", "20", "A-01"],
    ].map((row) => row.map((value) => `"${value}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "inventory-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const parseCsv = (text) => {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return [];
    const delimiter = [",", ";", "\t"].sort((a, b) => {
      const count = (line, character) => line.split(character).length - 1;
      return count(lines[0], b) - count(lines[0], a);
    })[0];
    const parseLine = (line) => {
      const values = [];
      let value = "";
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"' && line[index + 1] === '"') {
          value += '"';
          index += 1;
        } else if (character === '"') {
          quoted = !quoted;
        } else if (character === delimiter && !quoted) {
          values.push(value.trim());
          value = "";
        } else {
          value += character;
        }
      }
      values.push(value.trim());
      return values;
    };
    const headers = parseLine(lines[0].replace(/^\uFEFF/, "")).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const getValue = (values, aliases) => {
      const index = aliases.map((alias) => headers.indexOf(alias)).find((headerIndex) => headerIndex >= 0);
      return index === undefined ? "" : values[index] || "";
    };
    return lines.slice(1).map((line, index) => {
      const values = parseLine(line);
      return {
        line: index + 2,
        sku: getValue(values, ["sku", "productsku", "itemsku"]),
        barcode: getValue(values, ["barcode", "upc", "ean"]),
        productName: getValue(values, ["product", "productname", "item", "itemname", "description"]),
        branchCode: getValue(values, ["branchcode", "code"]),
        branch: getValue(values, ["branch", "branchname", "location", "store"]),
        quantity: getValue(values, ["quantity", "qty", "stock", "onhand", "count"]),
        reorderLevel: getValue(values, ["reorderlevel", "reorderpoint", "minimumstock", "minstock"]),
        shelfLocation: getValue(values, ["shelflocation", "shelf", "rack", "bin"]),
      };
    });
  };

  const handleImportFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportResult(null);
    setImportPreview([]);
    const reader = new FileReader();
    reader.onload = () => setImportRows(parseCsv(String(reader.result || "")));
    reader.readAsText(file);
    event.target.value = "";
  };

  const handleReviewImport = async () => {
    if (!importRows.length) return;
    try {
      setImporting(true);
      const response = await api.post("/inventory/import", { rows: importRows, preview: true });
      const result = response.data || {};
      setImportResult(result);
      setImportPreview(result.previewRows || []);
      message.success(`${result.imported || 0} record(s) ready to import.`);
    } catch (error) {
      message.error(error.response?.data?.message || "Failed to review inventory import.");
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    if (!importPreview.length) return;
    try {
      setImporting(true);
      const response = await api.post("/inventory/import", { rows: importRows });
      const result = response.data || {};
      setImportResult(result);
      message.success(`${result.imported || 0} inventory record(s) imported.`);
      if (result.errors?.length) message.warning(`${result.errors.length} row(s) were skipped or had errors.`);
      setImportOpen(false);
      setImportRows([]);
      setImportPreview([]);
      setImportFileName("");
      await fetchInventory();
    } catch (error) {
      message.error(error.response?.data?.message || "Failed to import inventory.");
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (focusedSku) setSearch(focusedSku);
  }, [focusedSku]);

  useEffect(() => {
    if (loading || !focusedSku || !filteredInventory.length) return undefined;
    const timer = window.setTimeout(() => {
      document.querySelector(".product-focused-row")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [loading, filteredInventory, focusedSku]);



  // =========================
  // STATISTICS
  // =========================

  const totalStock = inventory.reduce(
    (total, item) => total + Math.max((item.quantity || 0) - (item.reservedQuantity || 0), 0),
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
  // UPDATE STOCK
  // =========================

  const closeStockUpdate = () => {
    if (saving) return;
    stockUpdateForm.resetFields();
    setStockUpdateOpen(false);
  };

  const handleStockUpdate = async ({ updateType, inventoryId, quantity, reason, notes }) => {
    const correction = updateType === "correction";
    const path = correction ? "/inventory-transactions/adjust" : "/inventory-transactions/receive";
    const values = {
      inventoryId,
      ...(correction ? { newQuantity: quantity, reason } : { quantity, reason: "Stock received" }),
      notes,
    };

    try {
      setSaving(true);

      await postStockAction(path, values);

      message.success("Stock updated successfully.");

      stockUpdateForm.resetFields();

      setStockUpdateOpen(false);

      await fetchInventory();
    } catch (error) {
      console.error(error);

      message.error(
        error.response?.data?.message || "Failed to update stock.",
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

      render: (value) => value || "ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â",
    },

    {
      title: "Reference",
      dataIndex: "reference",
      key: "reference",

      render: (value) => value || "ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â",
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

          {canManageStock && (
            <Button
              type="primary"
              icon={<InboxOutlined />}
              onClick={() => setStockUpdateOpen(true)}
            >
              Update Stock
            </Button>
          )}

          <Button icon={<DownloadOutlined />} onClick={exportInventory}>
            Export Inventory
          </Button>

          {canManageStock && (
            <Button icon={<UploadOutlined />} onClick={() => { setImportOpen(true); setImportResult(null); setImportPreview([]); }}>
              Import Inventory
            </Button>
          )}
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

          <Col xs={24} md={6} lg={5}>
            <Button block size="large" icon={<ClearOutlined />} onClick={clearFilters}>
              Clear filters
            </Button>
          </Col>
        </Row>
      </Card>

      {/* TABLE */}

      <Card className="inventory-table-card" title="Inventory records">
        <Table
          columns={columns}
          dataSource={filteredInventory}
          rowKey="_id"
          rowClassName={(record) => (record.product?.sku === focusedSku ? "product-focused-row" : "")}
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

      <Modal
        title="Import Inventory"
        open={importOpen}
        onCancel={() => {
          if (!importing) {
            setImportOpen(false);
            setImportRows([]);
            setImportFileName("");
            setImportResult(null);
            setImportPreview([]);
          }
        }}
        onOk={importPreview.length ? handleImport : handleReviewImport}
        okText={importPreview.length ? "Confirm import" : "Review import"}
        confirmLoading={importing}
        width={900}
      >
        <Text type="secondary">
          Upload a CSV using common columns such as Product, SKU, Barcode, Branch, Quantity, Reorder Level, and Shelf. Headers and separators are detected automatically. Review the proposed additions before confirming. Existing product/branch records are skipped safely.
        </Text>
        <div className="inventory-import-template">
          <div>
            <Text strong>Standard CSV headers</Text>
            <Text code>Product, Branch, Quantity, Reorder Level, Shelf Location</Text>
          </div>
          <Button size="small" icon={<DownloadOutlined />} onClick={downloadImportTemplate}>
            Download template
          </Button>
        </div>
        <div className="inventory-import-upload">
          <input type="file" accept=".csv,text/csv" onChange={handleImportFile} />
          {importFileName && <Text type="secondary">{importFileName} - {importRows.length} row(s) ready</Text>}
        </div>
        {(importRows.length > 0 || importPreview.length > 0) && (
          <Table
            size="small"
            rowKey="line"
            dataSource={(importPreview.length ? importPreview : importRows).slice(0, 10)}
            pagination={false}
            columns={[
              { title: "Line", dataIndex: "line" },
              { title: "Product", dataIndex: "productName", render: (value, row) => value || row.sku || row.barcode },
              { title: "Branch", dataIndex: "branchCode", render: (value, row) => value || row.branch || row.branchName },
              { title: "Quantity", dataIndex: "quantity" },
              { title: "Reorder", dataIndex: "reorderLevel" },
              { title: "Shelf", dataIndex: "shelfLocation" },
            ]}
          />
        )}
        {(importPreview.length ? importPreview.length : importRows.length) > 10 && <Text type="secondary">Showing the first 10 rows. All {importPreview.length || importRows.length} rows will be submitted.</Text>}
        {importResult?.errors?.length > 0 && (
          <div className="inventory-import-errors">
            <Text strong>{importResult.errors.length} row(s) need attention</Text>
            {importResult.errors.map((error, index) => (
              <div key={`${error.line}-${index}`}>Line {error.line}: {error.message}</div>
            ))}
          </div>
        )}
      </Modal>

      {/* =========================
          UPDATE STOCK MODAL
      ========================= */}

      <Modal
        title="Update Stock"
        open={stockUpdateOpen}
        onCancel={closeStockUpdate}
        closable={!saving}
        keyboard={!saving}
        maskClosable={!saving}
        footer={null}
      >
        <Form
          form={stockUpdateForm}
          name="stock-update"
          layout="vertical"
          initialValues={{ updateType: "delivery" }}
          disabled={saving}
          onFinish={handleStockUpdate}
        >
          <Form.Item label="Update type" name="updateType">
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              options={[
                { label: "Delivery", value: "delivery" },
                { label: "Correction", value: "correction" },
              ]}
              onChange={() => stockUpdateForm.resetFields(["quantity", "reason"])}
            />
          </Form.Item>

          <Form.Item
            label="Product and branch"
            name="inventoryId"
            rules={[
              {
                required: true,
                message: "Select a product and branch.",
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
            key={stockUpdateType}
            label={isCorrection ? "Correct stock count" : "Quantity delivered"}
            name="quantity"
            extra={isCorrection
              ? `Enter the actual total in stock.${reservedQuantity > 0 ? ` At least ${reservedQuantity} units must remain for reservations.` : ""}`
              : "This quantity will be added to your current stock."}
            rules={[
              {
                required: true,
                message: isCorrection ? "Enter the correct stock count." : "Enter the quantity delivered.",
              },
              {
                type: "number",
                validator: (_, value) => {
                  if (value == null || (isCorrection ? value >= reservedQuantity : value > 0)) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(isCorrection
                    ? `Stock count must be at least ${reservedQuantity}.`
                    : "Delivered quantity must be greater than zero."));
                },
              },
            ]}
          >
            <InputNumber
              min={isCorrection ? reservedQuantity : 0}
              style={{
                width: "100%",
              }}
              size="large"
            />
          </Form.Item>

          {isCorrection && (
            <Form.Item
              label="Reason"
              name="reason"
              preserve={false}
              rules={[{ required: true, message: "Select a reason for the correction." }]}
            >
              <Select
                placeholder="Select reason"
                options={[
                  { value: "Damaged stock", label: "Damaged stock" },
                  { value: "Lost stock", label: "Lost stock" },
                  { value: "Physical count correction", label: "Physical count correction" },
                  { value: "Expired stock", label: "Expired stock" },
                  { value: "Other", label: "Other" },
                ]}
              />
            </Form.Item>
          )}

          <Form.Item label="Notes (optional)" name="notes">
            <Input.TextArea rows={3} placeholder="Add any details about this stock update" />
          </Form.Item>

          <div className="action-modal-footer">
            <Button onClick={closeStockUpdate} disabled={saving}>
              Cancel
            </Button>

            <Button type="primary" htmlType="submit" loading={saving}>
              Update Stock
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
