import { BrowserRouter, Routes, Route } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";

import ProtectedRoute from "./routes/ProtectedRoute";

import Login from "./pages/Login/Login";

import AppLayout from "./components/layout/AppLayout/AppLayout";

import Dashboard from "./pages/Dashboard/Dashboard";
import Products from "./pages/Products/Products";
import Inventory from "./pages/Inventory/Inventory";
import StockHistory from "./pages/StockHistory/StockHistory";
import Suppliers from "./pages/Suppliers/Suppliers";
import PurchaseOrders from "./pages/PurchaseOrders/PurchaseOrders";
import POS from "./pages/POS/POS";
import Reservations from "./pages/Reservations/Reservations";
import ProductFinder from "./pages/ProductFinder/ProductFinder";
import AuditLogs from "./pages/AuditLogs/AuditLogs";
import UserManagement from "./pages/UserManagement/UserManagement";
import ComingSoon from "./pages/ComingSoon";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Dashboard />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/pos"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <POS />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/products"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Products />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/inventory"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Inventory />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/reservations"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Reservations />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/product-finder"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <ProductFinder />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/user-management"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <UserManagement />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <AuditLogs />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock-history"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <StockHistory />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/transfers"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <ComingSoon
                    title="Stock Transfers"
                    description="Move inventory between branches and keep stock levels balanced."
                  />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/suppliers"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Suppliers />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-orders"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <PurchaseOrders />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchases"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <ComingSoon
                    title="Purchases"
                    description="Track incoming purchases and maintain a complete purchasing history."
                  />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/customers"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <ComingSoon
                    title="Customers"
                    description="Manage customer profiles, purchase history, and customer relationships."
                  />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <ComingSoon
                    title="Reports"
                    description="Analyze sales, inventory, purchasing, and branch performance."
                  />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <ComingSoon
                    title="Settings"
                    description="Configure your store, users, branches, and system preferences."
                  />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="*"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Dashboard />
                </AppLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
