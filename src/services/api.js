import axios from "axios";

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

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

export default api;
