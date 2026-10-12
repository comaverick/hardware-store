import { useState } from "react";
import { Button, Card, Form, Input, Typography, message } from "antd";

import { LockOutlined, MailOutlined } from "@ant-design/icons";

import { useNavigate } from "react-router-dom";

import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { SESSION_EXPIRED_MESSAGE } from "../../services/authSession";

import "./Login.css";

const { Title, Text } = Typography;

const Login = () => {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const navigate = useNavigate();

  const { login, sessionExpired } = useAuth();
  const feedback = errorMessage || (sessionExpired ? SESSION_EXPIRED_MESSAGE : "");

  const handleLogin = async (values) => {
    try {
      setErrorMessage("");
      setLoading(true);

      const response = await api.post("/auth/login", values);

      login(response.data.token, response.data.user);

      message.success("Welcome back!");

      navigate("/dashboard", { replace: true });
    } catch (error) {
      const nextErrorMessage = error.userMessage || error.response?.data?.message || "Login failed";

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
            <h1 className="login-brand-name">
              <img
                className="login-brand-logo"
                src={`${process.env.PUBLIC_URL}/brand/anchor-hardware-logo.png`}
                alt="Anchor Hardware"
                width="300"
                height="100"
              />
            </h1>
            <span className="login-brand-caption">Staff portal</span>
          </div>

          <div className="login-card-frame">
            <Card className="login-card" bordered={false}>
              <div className="login-header">
              <div className="login-intro">
                <Title id="login-title" level={2}>Welcome back</Title>
                <Text>Sign in to your Anchor Hardware staff account.</Text>
              </div>
              </div>

              <div
                className={feedback ? "login-feedback login-feedback-visible" : "login-feedback"}
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
              >
                {feedback}
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
