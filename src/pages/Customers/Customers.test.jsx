import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageChannel as NodeMessageChannel } from "worker_threads";

import Customers from "./Customers";
import api from "../../services/api";

jest.mock("../../services/api", () => ({ get: jest.fn() }));

// Exercise the real UI components without initializing unrelated Ant Design widgets.
jest.mock("antd", () => ({
  Alert: jest.requireActual("antd/lib/alert").default,
  Button: jest.requireActual("antd/lib/button").default,
  Card: jest.requireActual("antd/lib/card").default,
  Empty: jest.requireActual("antd/lib/empty").default,
  Input: jest.requireActual("antd/lib/input").default,
  Select: jest.requireActual("antd/lib/select").default,
  Table: jest.requireActual("antd/lib/table").default,
  Tag: jest.requireActual("antd/lib/tag").default,
  Typography: jest.requireActual("antd/lib/typography").default,
}));
jest.mock("@ant-design/icons", () => ({
  ReloadOutlined: jest.requireActual("@ant-design/icons/lib/icons/ReloadOutlined").default,
  SearchOutlined: jest.requireActual("@ant-design/icons/lib/icons/SearchOutlined").default,
}));

const customer = {
  _id: "customer-1",
  name: "Alex Builder",
  email: "alex@example.com",
  emailVerified: true,
  isActive: true,
  createdAt: "2026-10-01T00:00:00Z",
};
const response = (customers = [customer], total = customers.length) => ({ data: { customers, total, page: 1, pageSize: 10 } });

const renderCustomers = () => {
  try {
    return render(<Customers />);
  } catch (error) {
    throw error.errors?.[0] || error;
  }
};
let messageChannels;

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue(response());
  messageChannels = [];
  global.MessageChannel = class extends NodeMessageChannel {
    constructor() {
      super();
      messageChannels.push(this);
    }
  };
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  const getComputedStyle = window.getComputedStyle;
  jest.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
});

afterEach(() => {
  messageChannels.forEach((channel) => {
    channel.port1.close();
    channel.port2.close();
  });
  jest.restoreAllMocks();
});

test("loads registered customer records and displays their verification and account status", async () => {
  renderCustomers();
  expect(await screen.findByText("Alex Builder")).toBeInTheDocument();
  expect(screen.getByText("alex@example.com")).toBeInTheDocument();
  expect(screen.getByText("Verified")).toBeInTheDocument();
  expect(screen.getByText("Active")).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/customers", expect.objectContaining({
    params: { search: "", status: "all", verification: "all", page: 1, pageSize: 10 },
  }));
});

test("searches the directory after typing and resets pagination when filters change", async () => {
  api.get.mockResolvedValue(response([customer], 26));
  renderCustomers();
  await screen.findByText("Alex Builder");
  fireEvent.click(screen.getByTitle("2"));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith("/customers", expect.objectContaining({
    params: expect.objectContaining({ page: 2 }),
  })));

  fireEvent.change(screen.getByLabelText("Search customers"), { target: { value: "alex" } });
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith("/customers", expect.objectContaining({
    params: expect.objectContaining({ search: "alex", page: 1 }),
  })));

  fireEvent.mouseDown(screen.getByLabelText("Account status"));
  fireEvent.click(screen.getByText("Inactive", { selector: ".ant-select-item-option-content" }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith("/customers", expect.objectContaining({
    params: expect.objectContaining({ search: "alex", status: "inactive", page: 1 }),
  })));

  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith("/customers", expect.objectContaining({
    params: expect.objectContaining({ search: "", status: "all", verification: "all", page: 1 }),
  })));
});

test("keeps a late response from replacing the latest search results", async () => {
  let resolveInitial;
  api.get.mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }));
  api.get.mockResolvedValue(response([{ ...customer, _id: "customer-2", name: "Sam Builder" }]));
  renderCustomers();
  fireEvent.change(screen.getByLabelText("Search customers"), { target: { value: "sam" } });
  expect(await screen.findByText("Sam Builder")).toBeInTheDocument();
  await act(async () => resolveInitial(response()));
  expect(screen.queryByText("Alex Builder")).not.toBeInTheDocument();
  expect(screen.getByText("Sam Builder")).toBeInTheDocument();
});

test("shows a retryable loading error and recovers when the server becomes available", async () => {
  api.get.mockRejectedValueOnce({ userMessage: "The server is unavailable." });
  renderCustomers();
  expect(await screen.findByRole("alert")).toHaveTextContent("The server is unavailable.");
  expect(screen.queryByText("No customer accounts yet.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Alex Builder")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("distinguishes an empty directory from a search with no matching customers", async () => {
  api.get.mockResolvedValue(response([]));
  renderCustomers();
  expect(await screen.findByText("No customer accounts yet.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search customers"), { target: { value: "missing" } });
  expect(await screen.findByText("No customers match these filters.")).toBeInTheDocument();
});
