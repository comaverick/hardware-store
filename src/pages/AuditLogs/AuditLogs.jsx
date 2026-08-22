import { useEffect, useMemo, useState } from "react";

import { Button, Card, Col, Empty, Input, Row, Select, Space, Spin, Table, Tag, Typography, message } from "antd";
import { ClearOutlined, DownloadOutlined } from "@ant-design/icons";
import api from "../../services/api";

import "./AuditLogs.css";

const { Text } = Typography;

const formatAction = (value = "") => {
  const [method, ...pathParts] = value.split(" ");
  const path = pathParts.join(" ").replace(/^\/api\//, "").replaceAll("/", " > ").replaceAll("-", " ");
  const resource = path || "system";
  const verbs = {
    GET: "Viewed",
    POST: "Created",
    PUT: "Updated",
    PATCH: "Updated",
    DELETE: "Deleted",
  };
  return `${verbs[method] || method || "Performed action"} ${resource}`;
};

const localDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  useEffect(() => {
    api
      .get("/audit-logs")
      .then(({ data }) => setLogs(data))
      .catch((error) =>
        message.error(
          error.response?.data?.message || "Could not load audit logs.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const actionOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.action).filter(Boolean))),
    [logs],
  );

  const accountOptions = useMemo(
    () =>
      Array.from(
        new Map(
          logs
            .filter((log) => log.actor?._id)
            .map((log) => [log.actor._id, log.actor]),
        ).values(),
      ),
    [logs],
  );

  const filteredLogs = useMemo(
    () =>
      logs.filter((log) => {
        const query = search.trim().toLowerCase();
        const searchable = [log.action, log.actor?.name, log.actor?.email, log.branch?.code, log.branch?.name, log.statusCode].filter(Boolean).join(" ").toLowerCase();
        const matchesSearch = !query || searchable.includes(query);
        const matchesAction = actionFilter === "ALL" || log.action === actionFilter;
        const matchesAccount = accountFilter === "ALL" || log.actor?._id === accountFilter;
        const matchesDate = !dateFilter || localDateKey(log.createdAt) === dateFilter;
        const isSuccess = Number(log.statusCode) < 400;
        const matchesStatus = statusFilter === "ALL" || (statusFilter === "SUCCESS" ? isSuccess : !isSuccess);
        return matchesSearch && matchesAction && matchesAccount && matchesDate && matchesStatus;
      }),
    [logs, search, actionFilter, accountFilter, dateFilter, statusFilter],
  );

  const clearFilters = () => {
    setSearch("");
    setActionFilter("ALL");
    setAccountFilter("ALL");
    setDateFilter("");
    setStatusFilter("ALL");
  };

  const exportLogs = () => {
    const rows = [
      ["Time", "Account", "Email", "Action", "Branch", "Status Code", "Result"],
      ...filteredLogs.map((log) => [
        new Date(log.createdAt).toISOString(),
        log.actor?.name || "Unknown account",
        log.actor?.email || "",
        log.action || "",
        log.branch?.code || log.branch?.name || "N/A",
        log.statusCode ?? "",
        Number(log.statusCode) < 400 ? "Success" : "Failed",
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "audit-logs-export.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const columns = [
    {
      title: "Time",
      dataIndex: "createdAt",
      render: (value) => (
        <div className="audit-time">
          <strong>{new Date(value).toLocaleDateString()}</strong>
          <Text type="secondary">{new Date(value).toLocaleTimeString()}</Text>
        </div>
      ),
    },
    {
      title: "Account",
      dataIndex: "actor",
      render: (actor) => (
        <div className="audit-actor">
          <strong>{actor?.name || "Unknown account"}</strong>
          <Text type="secondary">{actor?.email || "No email"}</Text>
        </div>
      ),
    },
    {
      title: "Action",
      dataIndex: "action",
      render: (value) => (
        <div className="audit-action">
          <strong>{formatAction(value)}</strong>
          <Text type="secondary">{value}</Text>
        </div>
      ),
    },
    {
      title: "Branch",
      dataIndex: "branch",
      render: (branch) => branch?.code || branch?.name || "N/A",
    },
    {
      title: "Result",
      dataIndex: "statusCode",
      render: (value) => {
        const success = Number(value) < 400;
        return (
          <div className="audit-result">
            <Tag color={success ? "green" : "red"}>
              {success ? "Success" : "Failed"}
            </Tag>
            <Text type="secondary">HTTP {value}</Text>
          </div>
        );
      },
    },
  ];

  return (
    <div className="audit-page">
      <div className="audit-header">
        <Space>
          <Tag className="audit-count-tag">{filteredLogs.length} of {logs.length} activity records</Tag>
          <Button icon={<DownloadOutlined />} onClick={exportLogs}>Export Logs</Button>
        </Space>
      </div>

      <Card className="audit-filter-card" title="Filter account activity">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={4}>
            <Input
              size="large"
              placeholder="Search activity, account, or branch"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} md={4}>
            <Select
              size="large"
              value={actionFilter}
              onChange={setActionFilter}
              style={{ width: "100%" }}
              placeholder="Filter by action"
              options={[
                { value: "ALL", label: "All actions" },
                ...actionOptions.map((action) => ({
                  value: action,
                  label: formatAction(action),
                })),
              ]}
            />
          </Col>
          <Col xs={24} md={4}>
            <Select
              size="large"
              value={accountFilter}
              onChange={setAccountFilter}
              style={{ width: "100%" }}
              placeholder="Filter by account"
              options={[
                { value: "ALL", label: "All accounts" },
                ...accountOptions.map((account) => ({
                  value: account._id,
                  label: `${account.name} (${account.role || "User"})`,
                })),
              ]}
            />
          </Col>
          <Col xs={24} md={4}>
            <Input
              size="large"
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              aria-label="Filter by date"
              suffix={dateFilter ? <button type="button" className="audit-clear-date" onClick={() => setDateFilter("")}>Clear</button> : null}
            />
          </Col>
          <Col xs={24} md={4}>
            <Select
              size="large"
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: "100%" }}
              options={[
                { value: "ALL", label: "All results" },
                { value: "SUCCESS", label: "Successful only" },
                { value: "FAILED", label: "Failed only" },
              ]}
            />
          </Col>
          <Col xs={24} md={4}>
            <Button block size="large" icon={<ClearOutlined />} onClick={clearFilters}>
              Clear filters
            </Button>
          </Col>
        </Row>
      </Card>

      <Card className="audit-table-card" title="Account activity log">
        {loading ? (
          <div className="audit-loading"><Spin /></div>
        ) : filteredLogs.length ? (
          <Table
            rowKey="_id"
            columns={columns}
            dataSource={filteredLogs}
            scroll={{ x: 900 }}
            pagination={{ pageSize: 20, showTotal: (total) => `${total} records` }}
          />
        ) : (
          <Empty description="No account actions match these filters." />
        )}
      </Card>
    </div>
  );
};

export default AuditLogs;
