import { useEffect, useState } from "react";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";

import api from "../../services/api";

import "./UserManagement.css";

const { Title, Text } = Typography;

const roles = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER", "INVENTORY_STAFF"];

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const selectedRole = Form.useWatch("role", form);

  const loadData = async () => {
    try {
      const [usersResponse, branchesResponse] = await Promise.all([
        api.get("/users"),
        api.get("/branches"),
      ]);
      setUsers(usersResponse.data);
      setBranches(branchesResponse.data);
    } catch (error) {
      message.error(
        error.response?.data?.message || "Could not load user management data.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreate = () => {
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({ role: "CASHIER", isActive: true });
    setModalOpen(true);
  };

  const openEdit = (user) => {
    setEditingUser(user);
    form.setFieldsValue({
      name: user.name,
      email: user.email,
      role: user.role,
      branch: user.branch?._id,
      isActive: user.isActive,
      password: "",
    });
    setModalOpen(true);
  };

  const saveUser = async (values) => {
    try {
      setSaving(true);
      const payload = { ...values };
      if (!payload.password) delete payload.password;
      if (payload.role === "SUPER_ADMIN") delete payload.branch;

      if (editingUser) {
        await api.put(`/users/${editingUser._id}`, payload);
        message.success("User account updated.");
      } else {
        await api.post("/users", payload);
        message.success("User account created.");
      }
      setModalOpen(false);
      await loadData();
    } catch (error) {
      message.error(
        error.response?.data?.message || "Could not save the user account.",
      );
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: "Account",
      dataIndex: "name",
      render: (name, user) => (
        <div className="user-account-cell">
          <strong>{name}</strong>
          <Text type="secondary">{user.email}</Text>
        </div>
      ),
    },
    {
      title: "Role",
      dataIndex: "role",
      render: (role) => (
        <Tag color={role === "SUPER_ADMIN" ? "purple" : "blue"}>{role}</Tag>
      ),
    },
    {
      title: "Branch",
      dataIndex: "branch",
      render: (branch) =>
        branch ? `${branch.name} (${branch.code})` : "All branches",
    },
    {
      title: "Status",
      dataIndex: "isActive",
      render: (isActive) => (
        <Tag color={isActive ? "green" : "default"}>
          {isActive ? "Active" : "Inactive"}
        </Tag>
      ),
    },
    {
      title: "Action",
      key: "action",
      render: (_, user) => (
        <Button icon={<EditOutlined />} onClick={() => openEdit(user)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="user-management-page">
      <div className="user-management-header">
        <div>
          <Title level={2}>User Management</Title>
          <Text type="secondary">
            Create accounts, assign roles, and place employees at their branch.
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          New user
        </Button>
      </div>

      <Card>
        <Table
          rowKey="_id"
          loading={loading}
          columns={columns}
          dataSource={users}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title={editingUser ? "Edit user account" : "Create user account"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={saveUser}>
          <Form.Item
            name="name"
            label="Full name"
            rules={[{ required: true, message: "Enter the user name." }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              {
                required: true,
                type: "email",
                message: "Enter a valid email.",
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={editingUser ? "New password (optional)" : "Password"}
            rules={
              editingUser
                ? []
                : [
                    {
                      required: true,
                      min: 6,
                      message: "Use at least 6 characters.",
                    },
                  ]
            }
          >
            <Input.Password />
          </Form.Item>
          <div className="user-form-grid">
            <Form.Item name="role" label="Role" rules={[{ required: true }]}>
              <Select
                options={roles.map((role) => ({ label: role, value: role }))}
              />
            </Form.Item>
            <Form.Item
              name="branch"
              label="Assigned branch"
              rules={
                selectedRole === "SUPER_ADMIN"
                  ? []
                  : [{ required: true, message: "Select a branch." }]
              }
            >
              <Select
                disabled={selectedRole === "SUPER_ADMIN"}
                allowClear
                placeholder="Select branch"
                options={branches.map((branch) => ({
                  label: `${branch.name} (${branch.code})`,
                  value: branch._id,
                }))}
              />
            </Form.Item>
          </div>
          {editingUser && (
            <Form.Item
              name="isActive"
              label="Account active"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          )}
          <Space className="user-form-actions">
            <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={saving}>
              Save account
            </Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
};

export default UserManagement;
