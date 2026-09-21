import axios from "axios";

import { expireSession, SESSION_EXPIRED_MESSAGE } from "./authSession";

const isLoginRequest = (config) =>
  /\/auth\/login\/?(?:[?#]|$)/.test(config.url || "");

const configuredApiUrl = (
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://hardware-store-nffe.onrender.com"
    : "http://localhost:5000")
).replace(/\/+$/, "");

const apiBaseUrl = configuredApiUrl.endsWith("/api")
  ? configuredApiUrl
  : `${configuredApiUrl}/api`;

const api = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    const status = error.response?.status;

    if (status === 401 && !isLoginRequest(config)) {
      const authorization =
        config.headers?.get?.("Authorization") || config.headers?.Authorization;
      if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
        expireSession(authorization.slice(7));
      }
    }

    const shouldRetry =
      config.method === "get" &&
      !config.__retried &&
      (!error.response || status >= 500);

    if (shouldRetry) {
      config.__retried = true;
      await new Promise((resolve) => setTimeout(resolve, 500));
      return api(config);
    }

    error.userMessage = !error.response
      ? "The server is unavailable. Check your connection and try again."
      : status === 503
        ? "The system is temporarily unavailable while the database reconnects. Please try again shortly."
        : status === 401 && !isLoginRequest(config)
          ? SESSION_EXPIRED_MESSAGE
          : error.response.data?.message || "Something went wrong. Please try again.";

    return Promise.reject(error);
  },
);

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");

    if (token && !isLoginRequest(config)) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

export default api;
