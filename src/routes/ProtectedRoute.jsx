import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { canAccessModule } from "../config/moduleAccess";

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessModule(user.role, pathname)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default ProtectedRoute;
