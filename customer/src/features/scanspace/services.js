import { normalizeRoom } from "./core/domain";
const BASE = (process.env.REACT_APP_API_URL || "http://localhost:5000")
  .replace(/\/$/, "")
  .replace(/\/api$/, "");
function key() {
  let k = localStorage.getItem("scanspace:project-key");
  if (!k) {
    k = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
    localStorage.setItem("scanspace:project-key", k);
  }
  return k;
}
export async function api(path, body, method = body ? "POST" : "GET") {
  const headers = { "Content-Type": "application/json" };
  if (path !== "/catalog" && !path.startsWith("/catalog?"))
    headers["X-ScanSpace-Key"] = key();
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE}/api/scanspace${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (response.status === 204) return null;
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.message || "ScanSpace request failed.");
    return data;
  } finally {
    clearTimeout(timer);
  }
}
export function saveDraft(room) {
  localStorage.setItem("scanspace:draft", JSON.stringify(normalizeRoom(room)));
}
export function loadDraft() {
  const raw = localStorage.getItem("scanspace:draft");
  return raw ? normalizeRoom(JSON.parse(raw)) : null;
}
export function clearDraft() {
  localStorage.removeItem("scanspace:draft");
}

// Capture atlases stay in browser storage and are never submitted by the project API.
export async function captureStore(action, value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("scanspace-capture", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("assets");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction(
          "assets",
          action === "get" ? "readonly" : "readwrite",
        ),
        store = tx.objectStore("assets");
      let result;
      if (action === "get") {
        const r = store.get("current");
        r.onsuccess = () => {
          result = r.result;
        };
      } else if (action === "delete") store.delete("current");
      else store.put(value, "current");
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
