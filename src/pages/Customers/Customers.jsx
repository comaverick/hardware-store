import { useEffect, useState } from "react";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Input, Select, Table, Tag, Typography } from "antd";

import api from "../../services/api";

import "./Customers.css";

const { Text } = Typography;
const defaultQuery = { search: "", status: "all", verification: "all", page: 1, pageSize: 10 };
const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const columns = [
  {
    title: "Customer",
    key: "customer",
    width: 300,
    render: (_, customer) => (
      <div className="customer-account-cell">
        <strong>{customer.name || "Unnamed customer"}</strong>
        <Text type="secondary">{customer.email}</Text>
      </div>
    ),
  },
  {
    title: "Email verification",
    dataIndex: "emailVerified",
    width: 170,
    render: (verified) => (
      <Tag className={verified ? "customer-status-success" : "customer-status-warning"}>
        {verified ? "Verified" : "Unverified"}
      </Tag>
    ),
  },
  {
    title: "Account status",
    dataIndex: "isActive",
    width: 150,
    render: (active) => (
      <Tag className={active ? "customer-status-success" : "customer-status-inactive"}>
        {active ? "Active" : "Inactive"}
      </Tag>
    ),
  },
  {
    title: "Joined",
    dataIndex: "createdAt",
    width: 150,
    render: (value) => {
      const date = value ? new Date(value) : null;
      return date && !Number.isNaN(date.getTime())
        ? <time dateTime={date.toISOString()}>{dateFormatter.format(date)}</time>
        : "—";
    },
  },
];

const Customers = () => {
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(defaultQuery);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const term = search.trim();
      setQuery((current) => current.search === term
        ? current
        : { ...current, search: term, page: 1 });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const loadCustomers = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await api.get("/customers", {
          params: query,
          signal: controller.signal,
        });
        if (!active) return;
        // Return to the last available page if accounts changed since the previous request.
        const lastPage = Math.max(1, Math.ceil(response.data.total / query.pageSize));
        if (query.page > lastPage) {
          setQuery((current) => ({ ...current, page: lastPage }));
          return;
        }
        setCustomers(response.data.customers);
        setTotal(response.data.total);
      } catch (loadError) {
        if (!active) return;
        setCustomers([]);
        setTotal(0);
        setError(loadError.userMessage || loadError.response?.data?.message || "Could not load customer accounts.");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadCustomers();
    return () => {
      active = false;
      controller.abort();
    };
  }, [query, refreshKey]);

  const refresh = () => setRefreshKey((current) => current + 1);
  const updateFilter = (field, value) => setQuery((current) => ({ ...current, [field]: value, page: 1 }));
  const hasFilters = Boolean(query.search || query.status !== "all" || query.verification !== "all");
  const clearFilters = () => {
    setSearch("");
    setQuery((current) => ({ ...defaultQuery, pageSize: current.pageSize }));
  };

  return (
    <div className="customers-page">
      <div className="customers-header">
        <Text type="secondary">Storefront customer accounts across all branches.</Text>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>Refresh</Button>
      </div>

      <Card className="customers-filter-card" title="Find customers">
        <div className="customers-filters">
          <div className="customers-filter-field">
            <label htmlFor="customer-search">Search customers</label>
            <Input
              id="customer-search"
              prefix={<SearchOutlined />}
              placeholder="Search name or email..."
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </div>
          <div className="customers-filter-field">
            <label htmlFor="customer-status">Account status</label>
            <Select
              id="customer-status"
              value={query.status}
              onChange={(value) => updateFilter("status", value)}
              options={[
                { value: "all", label: "All accounts" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
            />
          </div>
          <div className="customers-filter-field">
            <label htmlFor="customer-verification">Email verification</label>
            <Select
              id="customer-verification"
              value={query.verification}
              onChange={(value) => updateFilter("verification", value)}
              options={[
                { value: "all", label: "All emails" },
                { value: "verified", label: "Verified" },
                { value: "unverified", label: "Unverified" },
              ]}
            />
          </div>
        </div>
      </Card>

      {error && (
        <Alert
          className="customers-error"
          type="error"
          title={error}
          showIcon
          action={<Button onClick={refresh}>Retry</Button>}
        />
      )}

      <Card
        className="customers-table-card"
        title="Customer accounts"
        extra={hasFilters && <Button type="text" onClick={clearFilters}>Clear filters</Button>}
      >
        <Table
          rowKey="_id"
          loading={loading}
          columns={columns}
          dataSource={customers}
          scroll={{ x: 770 }}
          locale={{
            emptyText: error
              ? "Customer accounts are unavailable. Use Retry to load them again."
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? "Loading customers..." : hasFilters ? "No customers match these filters." : "No customer accounts yet."} />,
          }}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 25, 50, 100],
            showTotal: (count, range) => `${range[0]}–${range[1]} of ${count} customers`,
            onChange: (page, pageSize) => setQuery((current) => ({
              ...current,
              page: pageSize === current.pageSize ? page : 1,
              pageSize,
            })),
          }}
        />
      </Card>
    </div>
  );
};

export default Customers;
