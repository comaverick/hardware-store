import { useState } from "react";
import { Button, Card, Form, Input, Typography, message } from "antd";

import { LockOutlined, MailOutlined } from "@ant-design/icons";

import { useNavigate } from "react-router-dom";

import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";

import "./Login.css";

const { Title, Text } = Typography;

const Login = () => {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const navigate = useNavigate();

  const { login } = useAuth();

  const handleLogin = async (values) => {
    try {
      setErrorMessage("");
      setLoading(true);

      const response = await api.post("/auth/login", values);

      login(response.data.token, response.data.user);

      message.success("Welcome back!");

      navigate("/dashboard");
    } catch (error) {
      const nextErrorMessage = error.response?.data?.message || "Login failed";

      setErrorMessage(nextErrorMessage);
      message.error(nextErrorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <main className="login-auth-region" aria-labelledby="login-title">
        <div className="login-auth-shell">
          <div className="login-brand-lockup login-brand-lockup-external">
            <div className="login-brand-mark">
              <svg
                className="login-logo"
                viewBox="0 0 40 40"
                role="img"
                aria-label="Hardware Management System"
              >
                <rect x="6" y="6" width="28" height="28" rx="7" />
                <path d="M13 14h14M13 20h8M13 26h14M24 17v6M28 17v6" />
                <circle cx="24" cy="14" r="1.5" />
                <circle cx="28" cy="26" r="1.5" />
              </svg>
            </div>

            <div className="login-brand-copy">
              <h1>Hardware Ops</h1>
              <span>Hardware Management System</span>
            </div>
          </div>

          <div className="login-card-frame">
            <Card className="login-card" bordered={false}>
              <div className="login-header">
              <div className="login-intro">
                <Title id="login-title" level={2}>Welcome back</Title>
                <Text>Sign in to continue to Hardware Ops.</Text>
              </div>
              </div>

              <div
                className={errorMessage ? "login-feedback login-feedback-visible" : "login-feedback"}
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
              >
                {errorMessage}
              </div>

              <Form
                className="login-form"
                layout="vertical"
                size="large"
                requiredMark={false}
                onFinish={handleLogin}
              >
              <Form.Item
                label="Email address"
                name="email"
                rules={[
                  {
                    required: true,
                    message: "Please enter your email address",
                  },
                ]}
              >
                <Input
                  prefix={<MailOutlined />}
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </Form.Item>

              <Form.Item
                label="Password"
                name="password"
                rules={[
                  {
                    required: true,
                    message: "Please enter your password",
                  },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              </Form.Item>

              <Button
                className="login-submit"
                type="primary"
                htmlType="submit"
                block
                loading={loading}
                aria-busy={loading}
              >
                Sign in
              </Button>
              </Form>
            </Card>

            <svg
              className="login-card-border-beam"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="login-beam-gradient" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#f96302" />
                  <stop offset="0.5" stopColor="#ffe0bd" />
                  <stop offset="1" stopColor="#ff7a1a" />
                </linearGradient>
              </defs>
              <rect className="login-card-border-track" x="0.25" y="0.25" width="99.5" height="99.5" rx="3.5" pathLength="100" />
              <rect className="login-card-border-beam-light" x="0.25" y="0.25" width="99.5" height="99.5" rx="3.5" pathLength="100" />
            </svg>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Login;
