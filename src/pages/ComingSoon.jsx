import {
  ArrowLeftOutlined,
  ClockCircleOutlined,
  ToolOutlined,
} from "@ant-design/icons";

import { Button, Typography } from "antd";
import { useNavigate } from "react-router-dom";

const { Title, Text } = Typography;

const ComingSoon = ({
  title = "Coming Soon",
  description = "This module is currently under development.",
}) => {
  const navigate = useNavigate();

  return (
    <>
      <style>
        {`
          .coming-soon-page {
            width: 100%;
            box-sizing: border-box;

            display: flex;
            align-items: center;
            justify-content: center;

            padding: 50px 20px;
          }

          .coming-soon-card {
            width: 100%;
            max-width: 620px;

            box-sizing: border-box;

            display: flex;
            flex-direction: column;
            align-items: center;

            text-align: center;

            padding: 54px 50px;

            border-radius: 26px;

            background: rgba(255, 255, 255, 0.9);

            border: 1px solid rgba(0, 0, 0, 0.06);

            box-shadow:
              0 16px 45px rgba(0, 0, 0, 0.06);

            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);

            animation: comingSoonFade 0.3s ease;
          }

          /* =========================
             ICON
          ========================= */

          .coming-soon-icon {
            width: 70px;
            height: 70px;

            display: flex;
            align-items: center;
            justify-content: center;

            margin-bottom: 20px;

            border-radius: 20px;

            background:
              linear-gradient(
                145deg,
                #f5f5f7,
                #e9e9ed
              );

            color: #111;

            font-size: 29px;

            box-shadow:
              inset 0 1px 0
                rgba(255, 255, 255, 0.8);
          }

          /* =========================
             BADGE
          ========================= */

          .coming-soon-badge {
            display: inline-flex;
            align-items: center;
            gap: 7px;

            padding: 6px 11px;

            border-radius: 999px;

            background: #f5f5f7;

            color: #8e8e93;

            font-size: 10px;
            font-weight: 700;

            letter-spacing: 0.5px;
          }

          /* =========================
             TITLE
          ========================= */

          .coming-soon-title {
            margin: 18px 0 8px !important;

            color: #111 !important;

            font-size: 32px !important;
            font-weight: 700 !important;

            letter-spacing: -0.7px;
          }

          /* =========================
             DESCRIPTION
          ========================= */

          .coming-soon-description {
            max-width: 480px;

            color: #6e6e73 !important;

            font-size: 14px;

            line-height: 1.6;
          }

          /* =========================
             DIVIDER
          ========================= */

          .coming-soon-divider {
            width: 100%;
            height: 1px;

            margin: 26px 0;

            background: rgba(0, 0, 0, 0.06);
          }

          /* =========================
             MESSAGE
          ========================= */

          .coming-soon-message {
            display: flex;
            flex-direction: column;

            gap: 6px;

            max-width: 460px;

            margin-bottom: 28px;
          }

          .coming-soon-message strong {
            color: #111;

            font-size: 14px;
          }

          .coming-soon-message span {
            color: #8e8e93;

            font-size: 13px;

            line-height: 1.6;
          }

          /* =========================
             BUTTON
          ========================= */

          .coming-soon-button {
            height: 42px;

            padding: 0 20px;

            border-radius: 11px;

            font-weight: 600;
          }

          /* =========================
             ANIMATION
          ========================= */

          @keyframes comingSoonFade {
            from {
              opacity: 0;
              transform: translateY(6px);
            }

            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          /* =========================
             MOBILE
          ========================= */

          @media (max-width: 600px) {

            .coming-soon-page {
              padding: 30px 12px;
            }

            .coming-soon-card {
              padding: 42px 24px;

              border-radius: 22px;
            }

            .coming-soon-icon {
              width: 62px;
              height: 62px;

              border-radius: 18px;

              font-size: 26px;
            }

            .coming-soon-title {
              font-size: 27px !important;
            }

            .coming-soon-description {
              font-size: 13px;
            }
          }
        `}
      </style>

      <div className="coming-soon-page">

        <div className="coming-soon-card">

          <div className="coming-soon-icon">
            <ToolOutlined />
          </div>

          <div className="coming-soon-badge">
            <ClockCircleOutlined />
            <span>UNDER DEVELOPMENT</span>
          </div>

          <Title className="coming-soon-title">
            {title}
          </Title>

          <Text className="coming-soon-description">
            {description}
          </Text>

          <div className="coming-soon-divider" />

          <div className="coming-soon-message">
            <strong>We're working on it.</strong>

            <span>
              This feature is planned for the Hardware
              Store Management System and will be available
              in a future update.
            </span>
          </div>

          <Button
            type="primary"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate("/dashboard")}
            className="coming-soon-button"
          >
            Back to Dashboard
          </Button>

        </div>

      </div>
    </>
  );
};

export default ComingSoon;