const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function setupProxy(app) {
  app.use((req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), xr-spatial-tracking=(self)",
    );
    next();
  });

  const target = process.env.REACT_APP_API_URL || "http://localhost:5000";
  app.use(
    "/api",
    createProxyMiddleware({
      target,
      changeOrigin: true,
    }),
  );
};
