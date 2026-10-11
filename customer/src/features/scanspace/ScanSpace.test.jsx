import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ScanSpace from "./ScanSpace";
import { CustomerAuthProvider } from "../../auth/CustomerAuthContext";
import { detectCapabilities } from "./core/depth";
import { rectangle } from "./core/domain";
import { api, captureStore, loadDraft } from "./services";
import { deleteAccountScan, listAccountScans, openAccountScan, pendingAccountScan } from "./accountScans";
import { serializeScan } from "./core/partialScanFile";
import { useScanSpace } from "./store";

jest.mock("./core/depth", () => ({ detectCapabilities: jest.fn() }));
jest.mock("./services", () => ({ ...jest.requireActual("./services"), api: jest.fn(), captureStore: jest.fn(), loadDraft: jest.fn() }));
jest.mock("./accountScans", () => ({ ...jest.requireActual("./accountScans"), deleteAccountScan: jest.fn(), listAccountScans: jest.fn(), openAccountScan: jest.fn(), pendingAccountScan: jest.fn() }));
jest.mock("./components/RoomEditor", () => ({ onExit, source }) => <div data-testid="room-editor" data-account={JSON.stringify(source?.account)}><h2>Room editor</h2><button onClick={onExit}>Close editor</button></div>);
jest.mock("./components/ScannerPanel", () => ({ onCancel }) => <div><h2>Camera scanner</h2><button onClick={onCancel}>Cancel scan</button></div>);
jest.mock("./components/PartialScanReview", () => ({ scan }) => <div data-testid="scan-review" data-customization={JSON.stringify(scan.customization)}>Imported scan review</div>);

const room = () => ({ ...rectangle(), name: "Bedroom" });
const alex = { uid: "customer-one", email: "alex@example.com", displayName: "Alex Customer", emailVerified: true };
const summary = () => ({ id: "a".repeat(24), name: "Bedroom", kind: "room", status: "ready", byteSize: 2048, revision: 3, updatedAt: "2026-10-10T03:00:00.000Z" });
function fixture(account = null, entry = "/scanspace") {
  let sync;
  const services = { watchUser: next => { sync = next; next(account); return () => {}; } };
  const view = render(<MemoryRouter initialEntries={[entry]}><CustomerAuthProvider services={services} loadProfile={async user => ({ name: user.displayName })}><ScanSpace /></CustomerAuthProvider></MemoryRouter>);
  return { ...view, switchAccount: user => sync(user) };
}
const guestReady = () => screen.findByRole("heading", { name: "Sign in to see your scans" });
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear(); useScanSpace.setState({ room: null, projectId: null, revision: 1 });
  api.mockResolvedValue([]); listAccountScans.mockResolvedValue([]); pendingAccountScan.mockResolvedValue(null);
  captureStore.mockResolvedValue(null); loadDraft.mockReturnValue(null); detectCapabilities.mockResolvedValue({ secure: true, ar: false });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  document.body.style.overflow = "auto";
});
afterEach(() => { document.body.style.overflow = ""; });

test("guests see account storage without querying account or browser-key saves", async () => {
  fixture(); await guestReady(); expect(screen.getByRole("heading", { level: 1, name: "Your spaces" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New scan" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(screen.getByRole("link", { name: "Sign in to your account" })).toHaveAttribute("href", "/login");
  expect(listAccountScans).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled();
});
test("the new-scan dialog disables unsupported cameras and restores scrolling", async () => {
  fixture(); await guestReady(); fireEvent.click(screen.getByRole("button", { name: "New scan" }));
  expect(screen.getByRole("button", { name: /Scan a room/ })).toBeDisabled(); expect(document.body.style.overflow).toBe("hidden");
  fireEvent.click(screen.getByRole("button", { name: "Close new scan" })); expect(document.body.style.overflow).toBe("auto");
  fireEvent.click(screen.getByRole("button", { name: "New scan" })); fireEvent.click(screen.getByRole("button", { name: /Enter measurements/ }));
  expect(await screen.findByLabelText("Room name")).toBeInTheDocument(); expect(screen.getByLabelText("Room width (m)")).toBeInTheDocument();
});
test("a supported device opens the scanner and returns to the welcome page", async () => {
  detectCapabilities.mockResolvedValue({ secure: true, ar: true }); fixture(); await guestReady();
  fireEvent.click(screen.getByRole("button", { name: "New scan" })); fireEvent.click(screen.getByRole("button", { name: /Scan a room/ }));
  expect(await screen.findByRole("heading", { name: "Camera scanner" })).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Cancel scan" })); await guestReady();
});
test("account scans reopen their original and current room design/revision", async () => {
  listAccountScans.mockResolvedValue([summary()]); openAccountScan.mockResolvedValue({ scan: { ...summary(), room: { ...room(), name: "Bedroom design" } }, file: { text: async () => JSON.stringify(room()) } });
  fixture(alex); fireEvent.click(await screen.findByRole("button", { name: "Open Bedroom" })); await screen.findByRole("heading", { name: "Room editor" });
  expect(openAccountScan).toHaveBeenCalledWith(alex, summary().id, expect.any(AbortSignal));
  expect(useScanSpace.getState()).toMatchObject({ projectId: null, room: { name: "Bedroom design" } });
  expect(JSON.parse(screen.getByTestId("room-editor").getAttribute("data-account"))).toMatchObject({ revision: 3, ownerUid: alex.uid });
  fireEvent.click(screen.getByRole("button", { name: "Close editor" })); expect(await screen.findByRole("button", { name: "Open Bedroom" })).toBeInTheDocument(); expect(api).not.toHaveBeenCalled();
});
test("local sessions resume without an upload or account save", async () => {
  loadDraft.mockReturnValue(room()); fixture(); await guestReady(); fireEvent.click(screen.getByRole("button", { name: /Continue last session Bedroom/ }));
  await screen.findByRole("heading", { name: "Room editor" }); expect(useScanSpace.getState().room.name).toBe("Bedroom"); expect(api).not.toHaveBeenCalled();
});
test("old browser-key rooms remain accessible through the device manager", async () => {
  let projects = [{ _id: summary().id, name: "Bedroom", updatedAt: summary().updatedAt }]; api.mockImplementation(async (path, body, method) => { if (method === "DELETE") projects = []; return projects; });
  fixture(); await guestReady(); fireEvent.click(screen.getByRole("button", { name: "Rooms saved on this device" }));
  const manager = await screen.findByRole("dialog", { name: "Saved rooms" }); fireEvent.click(await within(manager).findByRole("button", { name: "Delete Bedroom" }));
  await waitFor(() => expect(within(manager).queryByRole("button", { name: "Delete Bedroom" })).not.toBeInTheDocument());
  fireEvent.click(within(manager).getByRole("button", { name: "Close saved rooms" })); await guestReady(); expect(api).toHaveBeenCalledWith(`/projects/${summary().id}`, null, "DELETE");
});
test("account loading failures offer a retry and preserve the local draft", async () => {
  loadDraft.mockReturnValue(room()); listAccountScans.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce([]); fixture(alex);
  expect(await screen.findByRole("alert")).toHaveTextContent("saved scans could not load"); expect(screen.getByRole("button", { name: /Continue last session/ })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByRole("heading", { name: "No saved scans yet" });
});
test("signed-in customers see their own account list and account control", async () => {
  fixture(alex); await screen.findByRole("heading", { name: "No saved scans yet" });
  expect(screen.getByRole("link", { name: "Your account" })).toHaveAttribute("href", "/account"); expect(screen.getByText("Private to your account.")).toBeInTheDocument();
  expect(listAccountScans).toHaveBeenCalledWith(alex, expect.any(AbortSignal));
});
test("imports have no fixed size cap and continue rejecting diagnostics", async () => {
  const view = fixture(); await guestReady(); fireEvent.click(screen.getByRole("button", { name: "New scan" }));
  const contents = JSON.stringify(room()); const file = { name: "large-room.json", size: 128 * 1024 * 1024, text: async () => contents, slice: () => ({ text: async () => contents }) };
  fireEvent.change(screen.getByLabelText("ScanSpace file"), { target: { files: [file] } }); await screen.findByRole("heading", { name: "Room editor" }); view.unmount();
  fixture(); await guestReady(); fireEvent.click(screen.getByRole("button", { name: "New scan" })); const text = '{"capture":{"version":1,"keyframes":[]}}';
  fireEvent.change(screen.getByLabelText("ScanSpace file"), { target: { files: [{ name: "scanspace-debug-room.json", size: 100, text: async () => text, slice: () => ({ text: async () => text }) }] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("scan-diagnostics file");
});
test("account deletion requires confirmation before removing its card", async () => {
  listAccountScans.mockResolvedValue([summary()]); deleteAccountScan.mockResolvedValue(null); fixture(alex);
  fireEvent.click(await screen.findByRole("button", { name: "Delete Bedroom" })); expect(deleteAccountScan).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("dialog", { name: "Delete this scan?" })).getByRole("button", { name: "Delete scan" })); await screen.findByRole("heading", { name: "No saved scans yet" });
  expect(deleteAccountScan).toHaveBeenCalledWith(alex, summary().id, expect.any(AbortSignal));
});
test("stale responses cannot replace the next account's scan list", async () => {
  let finish; listAccountScans.mockImplementation(user => user.uid === alex.uid ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([]));
  const view = fixture(alex); await waitFor(() => expect(listAccountScans).toHaveBeenCalled()); await act(async () => view.switchAccount({ ...alex, uid: "other" }));
  await screen.findByRole("heading", { name: "No saved scans yet" }); await act(async () => finish([summary()])); expect(screen.queryByRole("button", { name: "Open Bedroom" })).not.toBeInTheDocument();
});
test("signing out closes an account original", async () => {
  listAccountScans.mockResolvedValue([summary()]); openAccountScan.mockResolvedValue({ scan: { ...summary(), room: room() }, file: { text: async () => JSON.stringify(room()) } });
  const view = fixture(alex); fireEvent.click(await screen.findByRole("button", { name: "Open Bedroom" })); await screen.findByRole("heading", { name: "Room editor" });
  await act(async () => view.switchAccount(null)); await guestReady(); expect(screen.queryByRole("heading", { name: "Room editor" })).not.toBeInTheDocument(); expect(useScanSpace.getState().room).toBeNull();
});
test("the original and finish design survive the sign-in round trip", async () => {
  const original = serializeScan({ name: "Captured room", cloud: { positions: new Float32Array([0, 0, 0, 1, 1, 1]), colors: new Uint8Array([1, 2, 3, 4, 5, 6]), count: 2, pointSize: .02 } });
  const customization = { version: 1, walls: { color: "#a0afa4", finish: "Matte" } };
  pendingAccountScan.mockImplementation(async action => action === "get" ? { kind: "scan", file: { text: async () => original }, metadata: { customization } } : null);
  fixture(alex, "/scanspace?resume=account-save"); expect(await screen.findByTestId("scan-review")).toHaveAttribute("data-customization", JSON.stringify(customization));
  await waitFor(() => expect(pendingAccountScan).toHaveBeenCalledWith("delete")); expect(openAccountScan).not.toHaveBeenCalled();
});
