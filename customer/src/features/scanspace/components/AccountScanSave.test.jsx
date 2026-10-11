import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { CustomerAuthProvider } from "../../../auth/CustomerAuthContext";
import AccountScanSave from "./AccountScanSave";
import { pendingAccountScan, saveAccountScan, updateAccountScan } from "../accountScans";

jest.mock("../accountScans", () => ({ pendingAccountScan: jest.fn(), saveAccountScan: jest.fn(), updateAccountScan: jest.fn() }));
const user = { uid: "alex", email: "alex@example.com", displayName: "Alex", emailVerified: true };
const metadata = { name: "Room", customization: { version: 1, walls: { color: "#a0afa4", finish: "Matte" } } };
const saved = { id: "a".repeat(24), name: "Room", revision: 1, status: "ready" };
const source = () => ({ kind: "scan", original: { name: "Raw source" }, file: new Blob(['{"format":"scanspace-scan"}'], { type: "application/json" }) });
function Location() { const location = useLocation(); return <div data-testid="location">{JSON.stringify({ pathname: location.pathname, state: location.state })}</div>; }
function fixture({ account = user, value = source(), onSaved = jest.fn() } = {}) {
  let sync; const services = { watchUser(next) { sync = next; next(account); return () => {}; } };
  const view = render(<MemoryRouter initialEntries={["/scanspace"]}><CustomerAuthProvider services={services} loadProfile={async () => ({ name: "Alex" })}><AccountScanSave source={value} metadata={metadata} onSaved={onSaved} /><Location /></CustomerAuthProvider></MemoryRouter>);
  return { ...view, value, onSaved, switchAccount: account => sync(account) };
}
async function submit() { fireEvent.click(await screen.findByRole("button", { name: "Save to account" })); fireEvent.click(screen.getByRole("button", { name: "Save", exact: true })); }
beforeEach(() => {
  jest.clearAllMocks(); pendingAccountScan.mockResolvedValue(null); saveAccountScan.mockResolvedValue(saved); updateAccountScan.mockResolvedValue({ ...saved, revision: 8 });
  Object.defineProperty(window, "crypto", { configurable: true, value: require("node:crypto").webcrypto });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
test("a guest's exact original is preserved before navigating to sign-in", async () => {
  const f = fixture({ account: null }); fireEvent.click(await screen.findByRole("button", { name: "Sign in to save" }));
  await waitFor(() => expect(pendingAccountScan).toHaveBeenCalledWith("put", expect.objectContaining({ file: f.value.file, metadata, kind: "scan" })));
  await waitFor(() => expect(JSON.parse(screen.getByTestId("location").textContent)).toMatchObject({ pathname: "/login", state: { from: "/scanspace?resume=account-save" } })); expect(saveAccountScan).not.toHaveBeenCalled();
});
test("failed preservation keeps the original visible and does not navigate", async () => {
  pendingAccountScan.mockRejectedValueOnce(new Error("Browser storage is full")); fixture({ account: null }); fireEvent.click(await screen.findByRole("button", { name: "Sign in to save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("storage is full"); expect(JSON.parse(screen.getByTestId("location").textContent).pathname).toBe("/scanspace");
});
test("account saves upload the original with a separate finish design", async () => {
  const f = fixture(); await submit(); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved to your account"));
  expect(saveAccountScan).toHaveBeenCalledWith(user, f.value.file, { ...metadata, kind: "scan" }, expect.any(String), expect.any(AbortSignal));
  expect(f.onSaved).toHaveBeenCalledWith({ ...saved, ownerUid: user.uid }); expect(f.value.original.customization).toBeUndefined();
});
test("retrying a save uses the same original and idempotency key", async () => {
  saveAccountScan.mockRejectedValueOnce(new Error("Upload interrupted")); const f = fixture(); await submit(); expect(await screen.findByRole("alert")).toHaveTextContent("Upload interrupted");
  await waitFor(() => expect(screen.getByRole("button", { name: "Save", exact: true })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Save", exact: true })); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved to your account"));
  expect(saveAccountScan.mock.calls[0][1]).toBe(f.value.file); expect(saveAccountScan.mock.calls[1][1]).toBe(f.value.file); expect(saveAccountScan.mock.calls[0][3]).toBe(saveAccountScan.mock.calls[1][3]);
});
test("existing account scans update design/revision without uploading again", async () => {
  const value = { ...source(), account: { ...saved, ownerUid: user.uid, revision: 7 } }; fixture({ value }); await submit(); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved to your account"));
  expect(updateAccountScan).toHaveBeenCalledWith(user, value.account, { ...metadata, kind: "scan" }, expect.any(AbortSignal)); expect(saveAccountScan).not.toHaveBeenCalled();
});
test("an account change discards the old save result and blocks a copy by another account", async () => {
  let finish; updateAccountScan.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const f = fixture({ value: { ...source(), account: { ...saved, ownerUid: user.uid } } });
  await submit(); await waitFor(() => expect(updateAccountScan).toHaveBeenCalled()); await act(async () => f.switchAccount({ ...user, uid: "other" })); await act(async () => finish(saved));
  expect(f.onSaved).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Open a scan from your account" })).toBeDisabled();
});
