import {
  BulbOutlined,
  ClearOutlined,
  RobotOutlined,
  SendOutlined,
  ShopOutlined,
  StockOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Alert, Button, Input, Spin } from "antd";
import { useEffect, useRef, useState } from "react";

import api from "../../services/api";
import "./Assistant.css";

const quickPrompts = [
  { label: "Today's sales", icon: <ShopOutlined />, prompt: "How much did we sell today and how many transactions were completed?" },
  { label: "Low-stock items", icon: <StockOutlined />, prompt: "Which products are low in stock and need attention?" },
  { label: "Find a product", icon: <BulbOutlined />, prompt: "What products do we have for repairing a leaking half-inch PVC pipe?" },
  { label: "Best sellers", icon: <ThunderboltOutlined />, prompt: "What were the best-selling products in the last 30 days?" },
];

const Assistant = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your Hardware Store Bolt. Ask me about sales, stock, products, or branch performance." },
  ]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, open]);

  const askQuestion = async (value = question) => {
    const cleanQuestion = value.trim();
    if (!cleanQuestion || loading) return;

    const nextMessages = [...messages, { role: "user", content: cleanQuestion }];
    setMessages(nextMessages);
    setQuestion("");
    setError("");
    setOpen(true);
    setLoading(true);

    try {
      const response = await api.post("/assistant", {
        question: cleanQuestion,
        messages: nextMessages.slice(-8),
      });
      setMessages((current) => [...current, { role: "assistant", content: response.data.answer }]);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "I could not connect to the assistant. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    setMessages([{ role: "assistant", content: "Conversation cleared. What would you like to know about your store?" }]);
    setError("");
  };

  return (
    <>
      {open && (
        <section className="assistant-float-panel" aria-label="Hardware Store Bolt">
          <div className="assistant-float-header">
            <div className="assistant-agent">
              <div className="assistant-agent-avatar"><RobotOutlined /></div>
              <div>
                <strong>Bolt</strong>
                <span>Live store insights</span>
              </div>
            </div>
            <div className="assistant-float-actions">
              <Button type="text" icon={<ClearOutlined />} onClick={clearConversation} disabled={loading} aria-label="Clear conversation" />
              <Button type="text" onClick={() => setOpen(false)} aria-label="Close assistant">X</Button>
            </div>
          </div>

          <div className="assistant-float-messages">
            {messages.map((message, index) => (
              <div className={"assistant-message assistant-message-" + message.role} key={message.role + "-" + index}>
                {message.role === "assistant" && <div className="assistant-message-avatar"><RobotOutlined /></div>}
                <div className="assistant-message-bubble">{message.content}</div>
              </div>
            ))}
            {loading && (
              <div className="assistant-message assistant-message-assistant">
                <div className="assistant-message-avatar"><RobotOutlined /></div>
                <div className="assistant-message-bubble assistant-thinking"><Spin size="small" /><span>Checking store data...</span></div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {!messages.some((message) => message.role === "user") && (
            <div className="assistant-float-prompts">
              {quickPrompts.map((item) => (
                <button type="button" className="assistant-prompt" key={item.label} onClick={() => askQuestion(item.prompt)} disabled={loading}>
                  <span className="assistant-prompt-icon">{item.icon}</span>
                  <span><strong>{item.label}</strong><small>{item.prompt}</small></span>
                </button>
              ))}
            </div>
          )}

          {error && <Alert className="assistant-error" type="error" showIcon message={error} />}

          <div className="assistant-composer">
            <Input.TextArea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  askQuestion();
                }
              }}
              autoSize={{ minRows: 1, maxRows: 4 }}
              placeholder="Ask about your store..."
              disabled={loading}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={() => askQuestion()} loading={loading} disabled={!question.trim()} aria-label="Ask assistant" />
          </div>
          <span className="assistant-composer-hint">Enter to ask - Shift + Enter for a new line</span>
        </section>
      )}

      <button
        type="button"
        className={"assistant-float-launcher" + (open ? " assistant-float-launcher-open" : "")}
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? "Close Hardware Store Bolt" : "Open Hardware Store Bolt"}
      >
        <span className="assistant-launcher-avatar"><RobotOutlined /></span>
        {!open && <span className="assistant-launcher-label">Ask Bolt</span>}
      </button>
    </>
  );
};

export default Assistant;
