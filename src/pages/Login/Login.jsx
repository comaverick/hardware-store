import { useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Typography,
  message,
} from "antd";

import {
  LockOutlined,
  MailOutlined,
} from "@ant-design/icons";

import { useNavigate } from "react-router-dom";

import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";

import "./Login.css";

const { Title, Text } = Typography;

const Login = () => {
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const { login } = useAuth();

  const handleLogin = async (values) => {
    try {
      setLoading(true);

      const response = await api.post(
        "/auth/login",
        values
      );

      login(
        response.data.token,
        response.data.user
      );

      message.success("Welcome back!");

      navigate("/dashboard");
    } catch (error) {
      message.error(
        error.response?.data?.message ||
          "Login failed"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <Card className="login-card">
        <div className="login-header">
          <div className="brand-mark">
            H
          </div>

          <Title level={2}>
            Hardware Store
          </Title>

          <Text type="secondary">
            Store Management System
          </Text>
        </div>

        <Form
          layout="vertical"
          size="large"
          onFinish={handleLogin}
        >
          <Form.Item
            label="Email"
            name="email"
            rules={[
              {
                required: true,
                message:
                  "Please enter your email",
              },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="Email"
            />
          </Form.Item>

          <Form.Item
            label="Password"
            name="password"
            rules={[
              {
                required: true,
                message:
                  "Please enter your password",
              },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Password"
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
          >
            Sign In
          </Button>
        </Form>
      </Card>
    </div>
  );
};

export default Login;