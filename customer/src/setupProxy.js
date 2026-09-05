// Development headers. Set the same header on the production static host.
module.exports = function setupScanSpaceHeaders(app) {
  app.use((req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), xr-spatial-tracking=(self)",
    );
    next();
  });
};
