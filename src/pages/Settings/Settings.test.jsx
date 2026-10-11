import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MessageChannel as NodeMessageChannel } from "worker_threads";

import Settings from "./Settings";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { printerFetch } from "../../services/printer";
import {
  getReceiptSettings,
  RECEIPT_SETTINGS_KEY,
} from "../../services/receiptSettings";

jest.mock("../../services/api", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../../context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("../../services/printer", () => ({ printerFetch: jest.fn() }));
jest.mock("antd", () =>
  Object.fromEntries(
    [
      "Alert",
      "Button",
      "Empty",
      "Form",
      "Input",
      "Modal",
      "Select",
      "Skeleton",
      "Switch",
      "Table",
      "Tag",
    ].map((name) => [
      name,
      jest.requireActual(`antd/lib/${name.toLowerCase()}`).default,
    ]),
  ),
);
jest.mock("@ant-design/icons", () =>
  Object.fromEntries(
    [
      "CheckCircleOutlined",
      "EnvironmentOutlined",
      "InfoCircleOutlined",
      "PlusOutlined",
      "PrinterOutlined",
      "ReloadOutlined",
      "SafetyCertificateOutlined",
      "SaveOutlined",
      "TeamOutlined",
      "UserOutlined",
    ].map((name) => [
      name,
      jest.requireActual(`@ant-design/icons/lib/icons/${name}`).default,
    ]),
  ),
);

const branches = [
  {
    _id: "branch-1",
    name: "Main Store",
    code: "MAIN",
    address: "12 Main Street",
    phone: "09171234567",
    isActive: true,
  },
  {
    _id: "branch-2",
    name: "North Store",
    code: "NORTH",
    address: "34 North Street",
    phone: "",
    isActive: false,
  },
];
const renderSettings = (path = "/settings", props = {}) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Settings {...props} />
    </MemoryRouter>,
  );
let channels;

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  useAuth.mockReturnValue({
    user: {
      id: "staff-1",
      name: "Store Administrator",
      email: "admin@example.com",
      role: "SUPER_ADMIN",
      branch: null,
    },
  });
  api.get.mockImplementation((path) =>
    Promise.resolve({
      data:
        path === "/branches"
          ? branches
          : {
              status: "ok",
              service: "hardware-store-api",
              database: { ready: true },
            },
    }),
  );
  printerFetch.mockImplementation((path) =>
    Promise.resolve({
      ok: true,
      json: async () =>
        path === "/printers"
          ? {
              success: true,
              printers: [{ name: "Receipt Printer", isDefault: true }],
              selectedPrinter: "Receipt Printer",
            }
          : { success: true, printer: "Receipt Printer", online: true },
    }),
  );
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
    matches: false,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  const getComputedStyle = window.getComputedStyle;
  jest
    .spyOn(window, "getComputedStyle")
    .mockImplementation((element) => getComputedStyle(element));
});

afterEach(() => {
  channels.forEach((channel) => {
    channel.port1.close();
    channel.port2.close();
  });
  jest.restoreAllMocks();
});

test("loads real branches, respects the global scope, and updates the branch picker", async () => {
  const onBranchOptionsChange = jest.fn();
  renderSettings("/settings", {
    branchScope: { selectedBranch: "branch-2" },
    onBranchOptionsChange,
  });
  const directory = within(screen.getByLabelText("Store and branch settings"));
  expect(
    (await directory.findByText("North Store")).closest("tr"),
  ).toHaveTextContent("Inactive");
  expect(directory.queryByText("Main Store")).not.toBeInTheDocument();
  expect(onBranchOptionsChange).toHaveBeenLastCalledWith(
    branches.map((branch) => ({
      id: branch._id,
      name: branch.name,
      code: branch.code,
    })),
  );
});

test("shows staff their account and omits administrator actions", async () => {
  useAuth.mockReturnValue({
    user: {
      name: "Branch Cashier",
      email: "cashier@example.com",
      role: "CASHIER",
      branch: { _id: "branch-1", name: "Main Store" },
    },
  });
  renderSettings("/settings?section=account");
  const account = screen.getByRole("region", {
    name: "Account and access settings",
  });
  expect(within(account).getByText("Branch Cashier")).toBeInTheDocument();
  expect(within(account).getByText("Main Store")).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Open User Management/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /View Audit Logs/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Store & branches" }));
  expect(
    screen.queryByRole("button", { name: "Add branch" }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith("/branches", expect.any(Object)),
  );
});

test("creates a branch using the existing API and renders the returned record", async () => {
  api.post.mockResolvedValue({
    data: {
      _id: "branch-3",
      name: "South Store",
      code: "SOUTH",
      address: "56 South Street",
      phone: "",
      isActive: true,
    },
  });
  renderSettings();
  const directory = within(screen.getByLabelText("Store and branch settings"));
  await directory.findByText("Main Store");
  fireEvent.click(screen.getByRole("button", { name: "Add branch" }));
  const dialog = within(
    screen.getByRole("dialog", { name: "Add a store branch" }),
  );
  fireEvent.change(dialog.getByLabelText("Branch name"), {
    target: { value: "South Store" },
  });
  fireEvent.change(dialog.getByLabelText("Branch code"), {
    target: { value: "south" },
  });
  fireEvent.change(dialog.getByLabelText("Address"), {
    target: { value: "56 South Street" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Create branch" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("/branches", {
      name: "South Store",
      code: "SOUTH",
      address: "56 South Street",
      phone: "",
    }),
  );
  expect(await directory.findByText("South Store")).toBeInTheDocument();
}, 15000);

test("prevents duplicate branch codes and keeps failed creation reviewable", async () => {
  api.post.mockRejectedValue({
    response: { data: { message: "Unable to create branch." } },
  });
  renderSettings();
  await within(screen.getByLabelText("Store and branch settings")).findByText(
    "Main Store",
  );
  fireEvent.click(screen.getByRole("button", { name: "Add branch" }));
  const dialog = within(
    screen.getByRole("dialog", { name: "Add a store branch" }),
  );
  fireEvent.change(dialog.getByLabelText("Branch name"), {
    target: { value: "Another Store" },
  });
  fireEvent.change(dialog.getByLabelText("Branch code"), {
    target: { value: "main" },
  });
  fireEvent.change(dialog.getByLabelText("Address"), {
    target: { value: "New Street" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Create branch" }));
  expect(
    await screen.findByText("A branch with this code already exists."),
  ).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText("Branch code"), {
    target: { value: "NEW" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Create branch" }));
  expect(
    await screen.findByText("Unable to create branch."),
  ).toBeInTheDocument();
  expect(dialog.getByLabelText("Branch name")).toHaveValue("Another Store");
}, 15000);

test("retries loading branches after a connection failure", async () => {
  api.get.mockRejectedValueOnce(new Error("Offline"));
  renderSettings();
  const directory = within(screen.getByLabelText("Store and branch settings"));
  expect(
    await screen.findByText("Branches could not be loaded"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await directory.findByText("Main Store")).toBeInTheDocument();
});

test.each(["SUPER_ADMIN", "ADMIN"])(
  "%s can save receipt text and automatic printing used by POS",
  async (role) => {
    useAuth.mockReturnValue({ user: { role } });
    renderSettings("/settings?section=receipts");
    expect(
      screen.getByRole("link", { name: "Receipts & printing" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Store name on receipts"), {
      target: { value: "Builder Supply" },
    });
    fireEvent.change(screen.getByLabelText("Receipt footer"), {
      target: { value: "Thanks for shopping locally!" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "Print after each sale" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(
        "Receipt preferences saved. POS will use them on this browser.",
      ),
    ).toBeInTheDocument();
    expect(getReceiptSettings()).toEqual({
      storeName: "Builder Supply",
      receiptFooter: "Thanks for shopping locally!",
      autoPrint: false,
    });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  },
);

test.each(["MANAGER", "CASHIER", "INVENTORY_STAFF"])(
  "%s cannot access receipt controls through a direct settings link",
  async (role) => {
    localStorage.setItem(
      RECEIPT_SETTINGS_KEY,
      JSON.stringify({
        storeName: "Approved Store",
        receiptFooter: "Thanks!",
        autoPrint: false,
      }),
    );
    useAuth.mockReturnValue({ user: { role, branch: "branch-1" } });
    renderSettings("/settings?section=receipts");

    expect(
      screen.getByText("Receipt settings are restricted"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Receipts & printing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Store name on receipts"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Receipt footer")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Print after each sale"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Selected printer")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/branches", expect.any(Object)),
    );
    expect(printerFetch).not.toHaveBeenCalled();
    expect(getReceiptSettings()).toEqual({
      storeName: "Approved Store",
      receiptFooter: "Thanks!",
      autoPrint: false,
    });

    fireEvent.click(screen.getByRole("link", { name: "Account & access" }));
    expect(
      screen.getByRole("region", { name: "Account and access settings" }),
    ).toBeInTheDocument();
  },
);

test("removes receipt controls when an administrator's role changes to cashier", async () => {
  const { rerender } = renderSettings("/settings?section=receipts");
  fireEvent.change(screen.getByLabelText("Store name on receipts"), {
    target: { value: "Unsaved Store" },
  });
  await screen.findByText("Printer connected and ready");
  useAuth.mockReturnValue({ user: { role: "CASHIER" } });
  rerender(
    <MemoryRouter initialEntries={["/settings?section=receipts"]}>
      <Settings />
    </MemoryRouter>,
  );
  expect(
    screen.getByText("Receipt settings are restricted"),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Store name on receipts"),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Selected printer")).not.toBeInTheDocument();
  expect(localStorage.getItem(RECEIPT_SETTINGS_KEY)).toBeNull();
});

test("preserves unsaved receipt changes between sections and supports discarding", async () => {
  renderSettings("/settings?section=receipts");
  fireEvent.change(screen.getByLabelText("Store name on receipts"), {
    target: { value: "Unsaved Store" },
  });
  fireEvent.click(screen.getByRole("link", { name: "Account & access" }));
  fireEvent.click(screen.getByRole("link", { name: "Receipts & printing" }));
  expect(screen.getByLabelText("Store name on receipts")).toHaveValue(
    "Unsaved Store",
  );
  expect(localStorage.getItem(RECEIPT_SETTINGS_KEY)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(screen.getByLabelText("Store name on receipts")).toHaveValue(
    "HARDWARE STORE",
  );
  await screen.findByText("Printer connected and ready");
});

test("allows receipt preferences to be saved while the physical printer is unavailable", async () => {
  printerFetch.mockRejectedValue(new Error("Offline"));
  renderSettings("/settings?section=receipts");
  expect(
    await screen.findByText("Printer needs attention"),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Store name on receipts"), {
    target: { value: "Offline Store" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(
    await screen.findByText(
      "Receipt preferences saved. POS will use them on this browser.",
    ),
  ).toBeInTheDocument();
});

test("reports browser storage failure without claiming preferences were saved", async () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  renderSettings("/settings?section=receipts");
  fireEvent.change(screen.getByLabelText("Store name on receipts"), {
    target: { value: "Blocked Store" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(
    await screen.findByText(
      "Could not save preferences. Allow browser storage and try again.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
});

test("checks real server health and shows a retryable database outage", async () => {
  api.get.mockImplementation((path) =>
    path === "/health"
      ? Promise.reject({
          response: {
            data: {
              message: "Database reconnecting.",
              service: "hardware-store-api",
              status: "degraded",
              database: { ready: false },
            },
          },
        })
      : Promise.resolve({ data: branches }),
  );
  renderSettings("/settings?section=system");
  expect(await screen.findByText("Database reconnecting.")).toBeInTheDocument();
  const system = screen.getByRole("region", {
    name: "System connection status",
  });
  expect(within(system).getByText("Needs attention")).toBeInTheDocument();
  expect(within(system).getByText("Reachable")).toBeInTheDocument();
  api.get.mockResolvedValue({
    data: {
      service: "hardware-store-api",
      status: "ok",
      database: { ready: true },
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  expect(await screen.findByText("Operational")).toBeInTheDocument();
});
