import { useEffect, useState } from "react";
import { Card, Empty, Spin, Table, Tag, Typography, message } from "antd";
import api from "../../services/api";

import "./AuditLogs.css";

const { Title, Text } = Typography;

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const columns = [
    {
      title: "Time",
      dataIndex: "createdAt",
      render: (value) => new Date(value).toLocaleString(),
    },
    {
      title: "Account",
      dataIndex: "actor",
      render: (actor) => (
        <div className="audit-actor">
          <strong>{actor?.name || "Unknown account"}</strong>
          <Text type="secondary">{actor?.email}</Text>
        </div>
      ),
    },
    {
      title: "Action",
      dataIndex: "action",
      render: (value) => <Text code>{value}</Text>,
    },
    {
      title: "Branch",
      dataIndex: "branch",
      render: (branch) => branch?.code || branch?.name || "—",
    },
    {
      title: "Result",
      dataIndex: "statusCode",
      render: (value) => (
        <Tag color={value < 400 ? "green" : "red"}>{value}</Tag>
      ),
    },
  ];

  return (
    <div className="audit-page">
      <div className="audit-header">
        <div>
          <Title level={2}>Audit Logs</Title>
          <Text type="secondary">
            Review account actions and branch activity.
          </Text>
        </div>
        <Tag color="blue">Account activity</Tag>
      </div>
      <Card>
        {loading ? (
          <div className="audit-loading">
            <Spin />
          </div>
        ) : logs.length ? (
          <Table
            rowKey="_id"
            columns={columns}
            dataSource={logs}
            pagination={{ pageSize: 20 }}
          />
        ) : (
          <Empty description="No account actions have been logged yet." />
        )}
      </Card>
    </div>
  );
};

export default AuditLogs;
