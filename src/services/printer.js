export const PRINTER_SERVER_URL = (
  process.env.REACT_APP_PRINTER_SERVER_URL || "http://localhost:5100"
).replace(/\/+$/, "");

export const printerFetch = (path, options = {}) =>
  fetch(`${PRINTER_SERVER_URL}${path}`, {
    ...options,
    targetAddressSpace: "loopback",
  });
