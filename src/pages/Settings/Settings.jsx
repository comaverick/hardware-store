import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CheckCircleOutlined,
  EnvironmentOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  Table,
  Tag,
} from "antd";

import { useAuth } from "../../context/AuthContext";
import api from "../../services/api";
import { printerFetch } from "../../services/printer";
import {
  canManageReceiptSettings,
  getReceiptSettings,
  saveReceiptSettings,
} from "../../services/receiptSettings";

import "./Settings.css";

const sections = [
  {
    key: "branches",
    label: "Store & branches",
    icon: EnvironmentOutlined,
    description: "Your store locations and contact details.",
  },
  {
    key: "receipts",
    label: "Receipts & printing",
    icon: PrinterOutlined,
    description: "Set up receipts and the printer for this workstation.",
  },
  {
    key: "account",
    label: "Account & access",
    icon: UserOutlined,
    description: "Your account, assigned branch, and permissions.",
  },
  {
    key: "system",
    label: "System status",
    icon: SafetyCertificateOutlined,
    description: "Check the connection to your store services.",
  },
];

const roleLabel = (role = "") =>
  role
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const getErrorMessage = (error, fallback) =>
  error.userMessage || error.response?.data?.message || fallback;
const requiredText = (message, max) => [
  { required: true, whitespace: true, message },
  { max, message: `Use ${max} characters or fewer.` },
];

const branchColumns = [
  {
    title: "Branch",
    dataIndex: "name",
    render: (name, branch) => (
      <div className="settings-branch-name">
        <strong>{name}</strong>
        <span>{branch.code}</span>
      </div>
    ),
  },
  {
    title: "Address",
    dataIndex: "address",
    render: (address) => (
      <span className="settings-branch-address">
        {address || "Not provided"}
      </span>
    ),
  },
  {
    title: "Phone",
    dataIndex: "phone",
    render: (phone) => phone || "Not provided",
  },
  {
    title: "Status",
    dataIndex: "isActive",
    width: 100,
    render: (active) => (
      <Tag
        className={`settings-status ${active ? "settings-status-success" : "settings-status-neutral"}`}
      >
        {active ? "Active" : "Inactive"}
      </Tag>
    ),
  },
];

const Settings = ({ branchScope, onBranchOptionsChange }) => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const activeSection =
    sections.find((section) => section.key === searchParams.get("section")) ||
    sections[0];
  const canManageBranches = user?.role === "SUPER_ADMIN";
  const canManageReceipts = canManageReceiptSettings(user?.role);
  const visibleSections = sections.filter(
    (section) => section.key !== "receipts" || canManageReceipts,
  );
  const canReviewActivity = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(
    user?.role,
  );
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState("");
  const [branchRefresh, setBranchRefresh] = useState(0);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [branchSaving, setBranchSaving] = useState(false);
  const [branchSaveError, setBranchSaveError] = useState("");
  const [branchNotice, setBranchNotice] = useState("");
  const [branchForm] = Form.useForm();
  const [receiptForm] = Form.useForm();
  const [savedReceipts, setSavedReceipts] = useState(getReceiptSettings);
  const [receiptDraft, setReceiptDraft] = useState(savedReceipts);
  const [receiptNotice, setReceiptNotice] = useState(null);
  const [printerState, setPrinterState] = useState({
    loading: false,
    printers: [],
    selected: "",
    online: false,
    error: "",
  });
  const [printerRefresh, setPrinterRefresh] = useState(0);
  const [printerSaving, setPrinterSaving] = useState(false);
  const [health, setHealth] = useState({
    loading: true,
    data: null,
    error: "",
    checkedAt: null,
  });
  const [healthRefresh, setHealthRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBranchesLoading(true);
    setBranchesError("");
    api
      .get("/branches", { signal: controller.signal, timeout: 10000 })
      .then(({ data }) => {
        if (active) setBranches(data);
      })
      .catch((error) => {
        if (active)
          setBranchesError(
            getErrorMessage(
              error,
              "Could not load branches. Please try again.",
            ),
          );
      })
      .finally(() => {
        if (active) setBranchesLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [branchRefresh]);

  useEffect(() => {
    onBranchOptionsChange?.(
      branches.map((branch) => ({
        id: branch._id,
        name: branch.name,
        code: branch.code,
      })),
    );
  }, [branches, onBranchOptionsChange]);

  useEffect(() => {
    if (activeSection.key !== "receipts" || !canManageReceipts)
      return undefined;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    setPrinterState((current) => ({ ...current, loading: true, error: "" }));
    const loadPrinter = async () => {
      try {
        const responses = await Promise.all([
          printerFetch("/printers", { signal: controller.signal }),
          printerFetch("/status", { signal: controller.signal }),
        ]);
        const [directory, status] = await Promise.all(
          responses.map((response) => response.json()),
        );
        if (
          responses.some((response) => !response.ok) ||
          !directory.success ||
          !status.success
        )
          throw new Error("Printer service unavailable.");
        if (active)
          setPrinterState({
            loading: false,
            printers: directory.printers || [],
            selected:
              status.printer ||
              directory.selectedPrinter ||
              directory.defaultPrinter ||
              "",
            online: status.online === true,
            error: "",
          });
      } catch {
        if (active)
          setPrinterState({
            loading: false,
            printers: [],
            selected: "",
            online: false,
            error:
              "The local printer service is unavailable. Start the print service on the computer connected to your receipt printer, then check again.",
          });
      } finally {
        window.clearTimeout(timeout);
      }
    };
    loadPrinter();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeSection.key, canManageReceipts, printerRefresh]);

  useEffect(() => {
    if (activeSection.key !== "system") return undefined;
    let active = true;
    const controller = new AbortController();
    setHealth((current) => ({ ...current, loading: true, error: "" }));
    api
      .get("/health", { signal: controller.signal, timeout: 10000 })
      .then(({ data }) => {
        if (active)
          setHealth({ loading: false, data, error: "", checkedAt: new Date() });
      })
      .catch((error) => {
        if (active)
          setHealth({
            loading: false,
            data: error.response?.data || null,
            error: getErrorMessage(
              error,
              "Could not connect to the store server. Please try again.",
            ),
            checkedAt: new Date(),
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeSection.key, healthRefresh]);

  const visibleBranches = useMemo(
    () =>
      !branchScope?.selectedBranch || branchScope.selectedBranch === "ALL"
        ? branches
        : branches.filter(
            (branch) =>
              String(branch._id) === String(branchScope.selectedBranch),
          ),
    [branches, branchScope?.selectedBranch],
  );
  const receiptDirty = Object.keys(savedReceipts).some(
    (key) => receiptDraft[key] !== savedReceipts[key],
  );
  const assignedBranch = branches.find(
    (branch) =>
      String(branch._id) === String(user?.branch?._id || user?.branch),
  );

  const createBranch = async (values) => {
    if (!canManageBranches) return;
    const payload = {
      name: values.name.trim(),
      code: values.code.trim().toUpperCase(),
      address: values.address.trim(),
      phone: values.phone?.trim() || "",
    };
    if (branches.some((branch) => branch.code === payload.code)) {
      branchForm.setFields([
        { name: "code", errors: ["A branch with this code already exists."] },
      ]);
      return;
    }
    setBranchSaving(true);
    setBranchSaveError("");
    try {
      const { data } = await api.post("/branches", payload);
      setBranches((current) => [...current, data]);
      setBranchModalOpen(false);
      branchForm.resetFields();
      setBranchNotice(`${data.name} was added to your store.`);
    } catch (error) {
      setBranchSaveError(
        getErrorMessage(
          error,
          "Could not create the branch. Please try again.",
        ),
      );
    } finally {
      setBranchSaving(false);
    }
  };

  const saveReceipts = (values) => {
    if (!canManageReceipts) return;
    try {
      const saved = saveReceiptSettings(values, user?.role);
      setSavedReceipts(saved);
      setReceiptDraft(saved);
      receiptForm.setFieldsValue(saved);
      setReceiptNotice({
        type: "success",
        message:
          "Receipt preferences saved. POS will use them on this browser.",
      });
    } catch {
      setReceiptNotice({
        type: "error",
        message:
          "Could not save preferences. Allow browser storage and try again.",
      });
    }
  };

  const selectPrinter = async (printer) => {
    if (!canManageReceipts) return;
    setPrinterSaving(true);
    setPrinterState((current) => ({ ...current, error: "" }));
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const response = await printerFetch("/printer/select", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printer }),
      });
      const data = await response.json();
      if (!response.ok || !data.success)
        throw new Error(
          data.message || data.error || "Could not select the printer.",
        );
      setPrinterState((current) => ({
        ...current,
        selected: data.printer || printer,
        online: data.online === true,
      }));
    } catch (error) {
      setPrinterState((current) => ({
        ...current,
        error:
          error.name === "AbortError"
            ? "The printer service did not respond. Please try again."
            : error.message,
      }));
    } finally {
      window.clearTimeout(timeout);
      setPrinterSaving(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-intro">
        <h2>Make the store work your way.</h2>
        <p>Manage your locations, receipt setup, and account in one place.</p>
      </div>
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <nav aria-label="Settings sections">
            {visibleSections.map(({ key, label, icon: Icon }) => (
              <Link
                key={key}
                to={`?section=${key}`}
                className={`settings-nav-item ${activeSection.key === key ? "settings-nav-active" : ""}`}
                aria-current={activeSection.key === key ? "page" : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="settings-scope-note">
            <InfoCircleOutlined />
            <p>
              Branch settings are shared. Receipt preferences apply to this
              browser.
            </p>
          </div>
        </aside>
        <div className="settings-main">
          <header className="settings-section-heading">
            <div>
              <h2>{activeSection.label}</h2>
              <p>{activeSection.description}</p>
            </div>
            {activeSection.key === "branches" && canManageBranches && (
              <Button
                type="primary"
                icon={<PlusOutlined aria-hidden="true" />}
                onClick={() => {
                  setBranchSaveError("");
                  setBranchModalOpen(true);
                }}
              >
                Add branch
              </Button>
            )}
            {activeSection.key === "system" && (
              <Button
                icon={<ReloadOutlined aria-hidden="true" />}
                loading={health.loading}
                onClick={() => setHealthRefresh((current) => current + 1)}
              >
                Check connection
              </Button>
            )}
          </header>

          <section
            hidden={activeSection.key !== "branches"}
            aria-label="Store and branch settings"
          >
            {branchNotice && (
              <Alert
                className="settings-alert"
                type="success"
                showIcon
                title={branchNotice}
                closable
                afterClose={() => setBranchNotice("")}
              />
            )}
            {branchesError && (
              <Alert
                className="settings-alert"
                type="error"
                showIcon
                title="Branches could not be loaded"
                description={branchesError}
                action={
                  <Button
                    onClick={() => setBranchRefresh((current) => current + 1)}
                  >
                    Try again
                  </Button>
                }
              />
            )}
            {!canManageBranches && (
              <div className="settings-permission-note">
                <SafetyCertificateOutlined />
                <span>
                  You can view your assigned branch. A super administrator can
                  add store locations.
                </span>
              </div>
            )}
            <div className="settings-panel settings-branch-panel">
              <div className="settings-panel-heading">
                <h3>Branch directory</h3>
                <span>
                  {branchesLoading
                    ? "Loading branches"
                    : `${visibleBranches.length} ${visibleBranches.length === 1 ? "branch" : "branches"}`}
                </span>
              </div>
              <Table
                rowKey="_id"
                columns={branchColumns}
                dataSource={visibleBranches}
                loading={branchesLoading}
                pagination={
                  visibleBranches.length > 10
                    ? { pageSize: 10, showSizeChanger: false }
                    : false
                }
                scroll={{ x: 620 }}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        branchesError
                          ? "Branch data is unavailable."
                          : "No branches in this scope."
                      }
                    />
                  ),
                }}
              />
              <div className="settings-panel-footnote">
                <EnvironmentOutlined />
                <span>
                  Branch details are used across inventory, sales, and
                  reservations.
                </span>
              </div>
            </div>
          </section>

          {activeSection.key === "receipts" && !canManageReceipts && (
            <Alert
              className="settings-alert"
              type="info"
              showIcon
              title="Receipt settings are restricted"
              description="Only Super Admins and Admins can change receipt preferences and printer selection. Contact an administrator for changes. You can still print and reprint receipts in POS."
            />
          )}

          {canManageReceipts && (
            <section
              hidden={activeSection.key !== "receipts"}
              aria-label="Receipt and printer settings"
            >
              {receiptNotice && (
                <Alert
                  className="settings-alert"
                  type={receiptNotice.type}
                  showIcon
                  title={receiptNotice.message}
                />
              )}
              <div className="settings-panel">
                <div className="settings-panel-heading">
                  <h3>Receipt preferences</h3>
                  <span className="settings-local-label">This browser</span>
                </div>
                <div className="settings-receipt-layout">
                  <Form
                    form={receiptForm}
                    layout="vertical"
                    initialValues={savedReceipts}
                    onFinish={saveReceipts}
                    onValuesChange={(_, values) => {
                      setReceiptDraft(values);
                      setReceiptNotice(null);
                    }}
                  >
                    <Form.Item
                      name="storeName"
                      label="Store name on receipts"
                      rules={requiredText("Enter a store name.", 80)}
                    >
                      <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item
                      name="receiptFooter"
                      label="Receipt footer"
                      rules={requiredText("Enter a receipt footer.", 200)}
                    >
                      <Input.TextArea rows={3} maxLength={200} showCount />
                    </Form.Item>
                    <div className="settings-switch-row">
                      <div>
                        <strong>Print after each sale</strong>
                        <p>
                          Send completed sales to the receipt printer
                          automatically.
                        </p>
                      </div>
                      <Form.Item
                        name="autoPrint"
                        valuePropName="checked"
                        noStyle
                      >
                        <Switch aria-label="Print after each sale" />
                      </Form.Item>
                    </div>
                    <div className="settings-form-actions">
                      <span role="status">
                        {receiptDirty
                          ? "Unsaved changes"
                          : "Preferences up to date"}
                      </span>
                      <div>
                        <Button
                          disabled={!receiptDirty}
                          onClick={() => {
                            receiptForm.setFieldsValue(savedReceipts);
                            setReceiptDraft(savedReceipts);
                            setReceiptNotice(null);
                          }}
                        >
                          Discard
                        </Button>
                        <Button
                          type="primary"
                          htmlType="submit"
                          icon={<SaveOutlined aria-hidden="true" />}
                          disabled={!receiptDirty}
                        >
                          Save changes
                        </Button>
                      </div>
                    </div>
                  </Form>
                  <aside
                    className="settings-receipt-preview"
                    aria-label="Receipt preview"
                  >
                    <span className="settings-preview-label">
                      Receipt preview
                    </span>
                    <div className="settings-paper">
                      <strong>{receiptDraft.storeName || "Store name"}</strong>
                      <span>
                        {assignedBranch?.name ||
                          visibleBranches[0]?.name ||
                          "Branch name"}
                      </span>
                      <small>Sales receipt</small>
                      <div className="settings-preview-items">
                        Your items and totals
                        <br />
                        will appear here.
                      </div>
                      <p>{receiptDraft.receiptFooter || "Receipt footer"}</p>
                    </div>
                  </aside>
                </div>
              </div>
              <div className="settings-panel settings-printer-panel">
                <div className="settings-panel-heading">
                  <h3>
                    <PrinterOutlined /> Receipt printer
                  </h3>
                  <Button
                    icon={<ReloadOutlined aria-hidden="true" />}
                    loading={printerState.loading}
                    disabled={printerSaving}
                    onClick={() => setPrinterRefresh((current) => current + 1)}
                  >
                    Check printer
                  </Button>
                </div>
                <div className="settings-panel-body">
                  {printerState.error && (
                    <Alert
                      className="settings-alert"
                      type="warning"
                      showIcon
                      title="Printer needs attention"
                      description={printerState.error}
                    />
                  )}
                  <div className="settings-printer-row">
                    <div>
                      <label htmlFor="settings-printer">Selected printer</label>
                      <p>
                        The selection is shared with POS on this workstation.
                      </p>
                    </div>
                    <Select
                      id="settings-printer"
                      aria-label="Selected printer"
                      value={printerState.selected || undefined}
                      loading={printerState.loading || printerSaving}
                      disabled={
                        printerState.loading ||
                        printerSaving ||
                        !printerState.printers.length
                      }
                      placeholder="No printer available"
                      options={printerState.printers.map((printer) => ({
                        value: printer.name,
                        label: `${printer.name}${printer.isDefault ? " (default)" : ""}`,
                      }))}
                      onChange={selectPrinter}
                    />
                  </div>
                  <div
                    className={`settings-printer-status ${printerState.online ? "settings-text-success" : ""}`}
                  >
                    <PrinterOutlined />
                    {printerState.loading
                      ? "Checking printer connection…"
                      : printerState.online
                        ? "Printer connected and ready"
                        : "Printer offline. You can still complete sales and view receipts in POS."}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section
            hidden={activeSection.key !== "account"}
            aria-label="Account and access settings"
          >
            <div className="settings-panel">
              <div className="settings-panel-heading">
                <h3>Your account</h3>
                <Tag className="settings-status settings-status-success">
                  Signed in
                </Tag>
              </div>
              <div className="settings-panel-body">
                <div className="settings-account-summary">
                  <div className="settings-account-avatar">
                    <UserOutlined />
                  </div>
                  <div>
                    <h3>{user?.name || "Staff account"}</h3>
                    <p>{roleLabel(user?.role)}</p>
                  </div>
                </div>
                <dl className="settings-details">
                  <div>
                    <dt>Email address</dt>
                    <dd>{user?.email || "Not provided"}</dd>
                  </div>
                  <div>
                    <dt>Assigned branch</dt>
                    <dd>
                      {canManageBranches
                        ? "All branches"
                        : assignedBranch?.name ||
                          user?.branch?.name ||
                          "No branch assigned"}
                    </dd>
                  </div>
                  <div>
                    <dt>Access level</dt>
                    <dd>
                      {canManageBranches
                        ? "Store administration across all branches"
                        : "Operations in your assigned branch"}
                    </dd>
                  </div>
                </dl>
                <p className="settings-account-help">
                  {canManageBranches
                    ? "Manage account details, passwords, and staff permissions in User Management."
                    : "Contact a super administrator to update your account details, password, or access."}
                </p>
                {canManageBranches && (
                  <Link className="settings-action-link" to="/user-management">
                    <TeamOutlined aria-hidden="true" /> Open User Management{" "}
                    <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>
            </div>
            {canReviewActivity && (
              <div className="settings-access-row">
                <div>
                  <h3>Keep track of changes</h3>
                  <p>
                    Review staff actions and operational activity in Audit Logs.
                  </p>
                </div>
                <Link className="settings-action-link" to="/audit-logs">
                  View Audit Logs <span aria-hidden="true">→</span>
                </Link>
              </div>
            )}
          </section>

          <section
            hidden={activeSection.key !== "system"}
            aria-label="System connection status"
          >
            {health.loading ? (
              <div className="settings-panel settings-panel-body">
                <Skeleton active paragraph={{ rows: 4 }} />
              </div>
            ) : (
              <div className="settings-panel">
                <div className="settings-panel-heading">
                  <h3>Store services</h3>
                  <Tag
                    className={`settings-status ${health.data?.status === "ok" && health.data?.database?.ready ? "settings-status-success" : "settings-status-warning"}`}
                  >
                    {health.data?.status === "ok" &&
                    health.data?.database?.ready
                      ? "Operational"
                      : "Needs attention"}
                  </Tag>
                </div>
                <div className="settings-panel-body">
                  {health.error && (
                    <Alert
                      className="settings-alert"
                      type="error"
                      showIcon
                      title="Connection needs attention"
                      description={health.error}
                    />
                  )}
                  <dl className="settings-details">
                    <div>
                      <dt>Store server</dt>
                      <dd>
                        {health.data?.service === "hardware-store-api"
                          ? "Reachable"
                          : "Unavailable"}
                      </dd>
                    </div>
                    <div>
                      <dt>Database</dt>
                      <dd
                        className={
                          health.data?.database?.ready
                            ? "settings-text-success"
                            : ""
                        }
                      >
                        {health.data?.database?.ready ? (
                          <>
                            <CheckCircleOutlined /> Connected
                          </>
                        ) : (
                          "Unavailable"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Last checked</dt>
                      <dd>
                        {health.checkedAt?.toLocaleString("en-PH", {
                          timeZone: "Asia/Manila",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}{" "}
                        (PH)
                      </dd>
                    </div>
                  </dl>
                  <div className="settings-permission-note">
                    <InfoCircleOutlined />
                    <span>
                      If a service is unavailable, check your connection and
                      retry. Receipt printer status is available under Receipts
                      & printing.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal
        title="Add a store branch"
        open={branchModalOpen}
        onCancel={() => {
          if (!branchSaving) setBranchModalOpen(false);
        }}
        footer={null}
        mask={{ closable: !branchSaving }}
        closable={!branchSaving}
      >
        <p className="settings-modal-description">
          Create a location for stock, sales, and customer pickups.
        </p>
        {branchSaveError && (
          <Alert
            className="settings-alert"
            type="error"
            showIcon
            title={branchSaveError}
          />
        )}
        <Form
          form={branchForm}
          layout="vertical"
          onFinish={createBranch}
          disabled={branchSaving}
        >
          <Form.Item
            name="name"
            label="Branch name"
            rules={requiredText("Enter the branch name.", 100)}
          >
            <Input placeholder="e.g. Main Store" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="code"
            label="Branch code"
            extra="A unique code using letters, numbers, hyphens, or underscores."
            normalize={(value) => value.toUpperCase()}
            rules={[
              ...requiredText("Enter a branch code.", 20),
              {
                pattern: /^[A-Z0-9][A-Z0-9_-]*$/,
                message: "Use letters, numbers, hyphens, or underscores.",
              },
            ]}
          >
            <Input placeholder="e.g. MAIN" maxLength={20} />
          </Form.Item>
          <Form.Item
            name="address"
            label="Address"
            rules={requiredText("Enter the branch address.", 300)}
          >
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
          <Form.Item
            name="phone"
            label="Phone number (optional)"
            rules={[{ max: 30, message: "Use 30 characters or fewer." }]}
          >
            <Input type="tel" maxLength={30} />
          </Form.Item>
          <div className="settings-modal-actions">
            <Button
              onClick={() => setBranchModalOpen(false)}
              disabled={branchSaving}
            >
              Cancel
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              icon={<PlusOutlined aria-hidden="true" />}
              loading={branchSaving}
            >
              Create branch
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default Settings;
