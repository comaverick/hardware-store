import { API_ORIGIN } from "../../storefrontCatalog";

async function request(user, path = "", { body, method = "GET", signal, original = false, requestKey } = {}) {
  if (!user) throw new Error("Sign in to save and open your scans.");
  const token = await user.getIdToken();
  if (signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
  const headers = { Authorization: `Bearer ${token}` };
  if (requestKey) headers["Idempotency-Key"] = requestKey;
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_ORIGIN}/api/customer-scans${path}`, {
    method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal, cache: "no-store",
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.message || "Your scan could not be saved or opened. Please retry."), { status: response.status, code: data.code });
  }
  return original ? response.blob() : response.json();
}

export async function listAccountScans(user, signal) {
  const data = await request(user, "", { signal });
  if (!Array.isArray(data.scans)) throw new Error("Your saved scans could not load.");
  return data.scans;
}
export async function openAccountScan(user, id, signal) {
  const path = `/${encodeURIComponent(id)}`;
  const [data, file] = await Promise.all([request(user, path, { signal }), request(user, `${path}/file`, { signal, original: true })]);
  return { scan: data.scan, file };
}
export async function saveAccountScan(user, file, metadata, requestKey, signal) {
  const body = new FormData();
  body.append("metadata", JSON.stringify(metadata));
  body.append("file", file, "scanspace-original.json");
  return (await request(user, "", { body, method: "POST", requestKey, signal })).scan;
}
export async function updateAccountScan(user, record, metadata, signal) {
  return (await request(user, `/${encodeURIComponent(record.id)}`, { method: "PATCH", body: { ...metadata, revision: record.revision }, signal })).scan;
}
export const deleteAccountScan = (user, id, signal) => request(user, `/${encodeURIComponent(id)}`, { method: "DELETE", signal });

// A temporary local original keeps the scan available across the sign-in screen.
// It shares the capture database but never replaces the local texture atlas.
export function pendingAccountScan(action, value) {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("This browser cannot preserve the scan for sign-in. Export it before signing in."));
    const request = indexedDB.open("scanspace-capture", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("assets");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("assets", action === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore("assets");
      let result;
      if (action === "get") {
        const read = store.get("pending-account-save");
        read.onsuccess = () => { result = read.result; };
      } else if (action === "delete") store.delete("pending-account-save");
      else store.put(value, "pending-account-save");
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("The scan could not be preserved on this device.")); };
      tx.onerror = () => { /* The transaction's abort event closes the database. */ };
    };
  });
}

export function scanFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
