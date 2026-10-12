const staffModules = {
  CASHIER: [
    "/dashboard",
    "/pos",
    "/products",
    "/customers",
    "/reservations",
    "/settings",
  ],
  INVENTORY_STAFF: [
    "/dashboard",
    "/products",
    "/inventory",
    "/stock-history",
    "/reservations",
    "/product-finder",
    "/settings",
  ],
};

export const canAccessModule = (role, pathname) => {
  const allowedModules = staffModules[role];
  if (!allowedModules) return true;

  const modulePath = pathname.replace(/\/+$/, "").toLowerCase();
  return allowedModules.includes(modulePath);
};
