import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Sidebar from "../components/layout/Sidebar/Sidebar";
import ProtectedRoute from "./ProtectedRoute";

let mockUser;
let mockLoading;

jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, loading: mockLoading }),
}));

const modules = [
  ["/dashboard", "Dashboard"],
  ["/pos", "Point of Sale"],
  ["/products", "Products"],
  ["/customers", "Customers"],
  ["/inventory", "Inventory"],
  ["/stock-history", "Stock History"],
  ["/reservations", "Reservations"],
  ["/product-finder", "AI Product Finder"],
  ["/reports", "Reports"],
  ["/audit-logs", "Audit Logs"],
  ["/user-management", "User Management"],
  ["/settings", "Settings"],
];

const staffAccess = [
  {
    role: "CASHIER",
    allowed: [
      "Dashboard", "Point of Sale", "Products", "Customers", "Reservations", "Settings",
    ],
  },
  {
    role: "INVENTORY_STAFF",
    allowed: [
      "Dashboard", "Products", "Inventory", "Stock History", "Reservations", "AI Product Finder", "Settings",
    ],
  },
];

beforeEach(() => {
  mockUser = { id: "staff-user", role: "CASHIER" };
  mockLoading = false;
});

const renderPage = (pathname) => render(
  <MemoryRouter initialEntries={[pathname]}>
    <Routes>
      <Route path="/login" element={<div>Login page</div>} />
      {modules.map(([path, label]) => (
        <Route
          key={path}
          path={path}
          element={<ProtectedRoute><div>{label} page</div></ProtectedRoute>}
        />
      ))}
    </Routes>
  </MemoryRouter>,
);

describe.each(staffAccess)("$role module access", ({ role, allowed }) => {
  test("shows only the allowed sidebar modules", () => {
    mockUser.role = role;
    render(
      <MemoryRouter>
        <Sidebar expanded setExpanded={jest.fn()} />
      </MemoryRouter>,
    );

    modules.forEach(([, label]) => {
      if (allowed.includes(label)) {
        expect(screen.getByRole("button", { name: label, exact: true })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: label, exact: true })).not.toBeInTheDocument();
      }
    });
    expect(screen.queryByText("Management")).not.toBeInTheDocument();
  });

  test.each(modules)("enforces direct access to %s", (path, label) => {
    mockUser.role = role;
    renderPage(path);

    const expected = allowed.includes(label) ? label : "Dashboard";
    expect(screen.getByText(`${expected} page`)).toBeInTheDocument();
    if (!allowed.includes(label)) {
      expect(screen.queryByText(`${label} page`)).not.toBeInTheDocument();
    }
  });
});

test.each(["SUPER_ADMIN", "ADMIN", "MANAGER"])("preserves %s module visibility", (role) => {
  mockUser.role = role;
  render(
    <MemoryRouter>
      <Sidebar expanded setExpanded={jest.fn()} />
    </MemoryRouter>,
  );

  modules.forEach(([, label]) => {
    if (label === "User Management" && role !== "SUPER_ADMIN") {
      expect(screen.queryByRole("button", { name: label, exact: true })).not.toBeInTheDocument();
    } else {
      expect(screen.getByRole("button", { name: label, exact: true })).toBeInTheDocument();
    }
  });
});

test("preserves case-insensitive routes and trailing slashes", () => {
  renderPage("/POS/");
  expect(screen.getByText("Point of Sale page")).toBeInTheDocument();
});

test("redirects signed-out users to login", () => {
  mockUser = null;
  renderPage("/pos");
  expect(screen.getByText("Login page")).toBeInTheDocument();
});

test("waits for authentication before deciding access", () => {
  mockLoading = true;
  renderPage("/inventory");
  expect(screen.queryByText("Inventory page")).not.toBeInTheDocument();
  expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  expect(screen.queryByText("Login page")).not.toBeInTheDocument();
});
