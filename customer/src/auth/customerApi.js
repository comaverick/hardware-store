import { API_ORIGIN } from "../storefrontCatalog";

export async function fetchCustomerProfile(user, signal) {
  const token = await user.getIdToken();
  const response = await fetch(`${API_ORIGIN}/api/customer-auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Your account could not load. Please try again.");
    error.status = response.status;
    throw error;
  }
  if (!data.customer || typeof data.customer.email !== "string" || !data.customer.id) {
    throw new Error("Your account could not load. Please try again.");
  }
  return data.customer;
}
