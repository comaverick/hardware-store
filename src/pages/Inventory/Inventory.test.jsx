import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MessageChannel as NodeMessageChannel } from "worker_threads";

import Inventory from "./Inventory";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { message } from "antd";

jest.setTimeout(20000);

jest.mock("../../services/api", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../../context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("antd", () => ({
  ...Object.fromEntries([
    "Button", "Card", "Col", "Empty", "Form", "Input", "InputNumber", "Modal",
    "Radio", "Row", "Select", "Space", "Statistic", "Table", "Tag", "Typography",
  ].map((name) => [name, jest.requireActual(`antd/lib/${name === "InputNumber" ? "input-number" : name.toLowerCase()}`).default])),
  message: { success: jest.fn(), error: jest.fn() },
}));
jest.mock("@ant-design/icons", () => Object.fromEntries([
  "AppstoreOutlined", "ClearOutlined", "DownloadOutlined", "UploadOutlined",
  "InboxOutlined", "SearchOutlined", "WarningOutlined", "HistoryOutlined",
].map((name) => [name, jest.requireActual(`@ant-design/icons/lib/icons/${name}`).default])));

const inventoryRecord = {
  _id: "inventory-1",
  product: { _id: "product-1", name: "Common Nail 2 inch", sku: "FST-NAIL-002", unit: "kilogram" },
  branch: { _id: "branch-1", name: "Main Store", code: "BR-001" },
  quantity: 20,
  reservedQuantity: 8,
  reorderLevel: 5,
  shelfLocation: "A-01",
};
let channels;

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { role: "SUPER_ADMIN" } });
  api.get.mockResolvedValue({ data: [inventoryRecord] });
  api.post.mockResolvedValue({ data: {} });
  channels = [];
  global.MessageChannel = class extends NodeMessageChannel {
    constructor() {
      super();
      channels.push(this);
    }
  };
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false, media: query, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(),
  }));
  const getComputedStyle = window.getComputedStyle;
  jest.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  channels.forEach((channel) => {
    channel.port1.close();
    channel.port2.close();
  });
  jest.restoreAllMocks();
});

const openStockUpdate = async () => {
  render(<MemoryRouter><Inventory /></MemoryRouter>);
  await screen.findByText("Common Nail 2 inch");
  fireEvent.click(screen.getByText("Update Stock", { selector: "button span" }).closest("button"));
  const dialog = await screen.findByRole("dialog", { hidden: true });
  fireEvent.mouseDown(within(dialog).getByLabelText("Product and branch"));
  fireEvent.click(await screen.findByText("Common Nail 2 inch - BR-001 (20 in stock)", {
    selector: ".ant-select-item-option-content",
  }));
  return dialog;
};

const submitStockUpdate = (dialog) => {
  fireEvent.click(within(dialog).getByText("Update Stock", { selector: "button span" }).closest("button"));
};

const chooseCorrectionReason = async (dialog) => {
  fireEvent.mouseDown(await within(dialog).findByLabelText("Reason"));
  fireEvent.click(await screen.findByText("Physical count correction", {
    selector: ".ant-select-item-option-content",
  }));
};

test("a delivery adds the entered quantity through the receive endpoint", async () => {
  const dialog = await openStockUpdate();
  expect(within(dialog).getByLabelText("Delivery")).toBeChecked();
  fireEvent.change(within(dialog).getByLabelText("Quantity delivered"), {
    target: { value: "10" },
  });
  submitStockUpdate(dialog);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    "/inventory-transactions/receive",
    { inventoryId: "inventory-1", quantity: 10, reason: "Stock received", notes: undefined },
    { headers: { "Idempotency-Key": expect.any(String) } },
  ));
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
});

test("switching to correction clears the delivery amount and submits an absolute count", async () => {
  const dialog = await openStockUpdate();
  fireEvent.change(within(dialog).getByLabelText("Quantity delivered"), {
    target: { value: "10" },
  });
  fireEvent.click(within(dialog).getByLabelText("Correction"));
  const count = await within(dialog).findByLabelText("Correct stock count");
  expect(count).toHaveValue("");
  fireEvent.change(count, { target: { value: "27" } });
  submitStockUpdate(dialog);
  expect(await within(dialog).findByText("Select a reason for the correction.")).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  await chooseCorrectionReason(dialog);
  submitStockUpdate(dialog);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    "/inventory-transactions/adjust",
    { inventoryId: "inventory-1", newQuantity: 27, reason: "Physical count correction", notes: undefined },
    { headers: { "Idempotency-Key": expect.any(String) } },
  ));
});

test("a correction cannot reduce stock below the reserved quantity", async () => {
  const dialog = await openStockUpdate();
  fireEvent.click(within(dialog).getByLabelText("Correction"));
  await chooseCorrectionReason(dialog);
  const count = within(dialog).getByLabelText("Correct stock count");
  fireEvent.change(count, {
    target: { value: "7" },
  });
  submitStockUpdate(dialog);
  await waitFor(() => {
    if (api.post.mock.calls.length) {
      expect(api.post.mock.calls[0][0]).toBe("/inventory-transactions/adjust");
      expect(api.post.mock.calls[0][1].newQuantity).toBeGreaterThanOrEqual(8);
    } else {
      expect(count).toHaveAttribute("aria-invalid", "true");
    }
  });
});

test("a failed delivery can be retried without creating a second stock operation", async () => {
  api.post.mockRejectedValueOnce({ response: { data: { message: "The server is unavailable." } } });
  const dialog = await openStockUpdate();
  fireEvent.change(within(dialog).getByLabelText("Quantity delivered"), {
    target: { value: "0.5" },
  });
  submitStockUpdate(dialog);
  await waitFor(() => expect(message.error).toHaveBeenCalledWith("The server is unavailable."));
  const firstCall = api.post.mock.calls[0];
  expect(firstCall[1].quantity).toBe(0.5);
  submitStockUpdate(dialog);
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post.mock.calls[1]).toEqual(firstCall);
});
