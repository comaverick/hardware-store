import { fireEvent, render, screen } from "@testing-library/react";
import PartialScanReview from "./PartialScanReview";
import { createFusionWorker } from "../core/createFusionWorker";
import { downloadScan } from "../core/partialScanFile";

jest.mock("../core/createFusionWorker", () => ({ createFusionWorker: jest.fn() }));
jest.mock("./PartialScanScene", () => ({ __esModule: true,
  default: ({ customization }) => <div data-testid="scan-preview" data-customization={JSON.stringify(customization)}>Checked scan preview</div> }));
jest.mock("../core/partialScanFile", () => ({ ...jest.requireActual("../core/partialScanFile"), downloadScan: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test("applying, exporting, and resetting a finish updates the scan view without changing the measured mesh", () => {
  const scan = { mesh: { triangleCount: 2,
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 2, 2.8, 0, 0, 2.8, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]) },
    captureQuality: { structuralDepth: { planes: [{ kind: "wall", normal: [0, 0, 1], offset: 0 }] } } };
  render(<PartialScanReview scan={scan} />);
  fireEvent.click(screen.getByRole("button", { name: "Sage", exact: true }));
  expect(screen.getByTestId("scan-preview")).toHaveAttribute("data-customization", "null");
  fireEvent.click(screen.getByRole("button", { name: "Apply to room" }));
  expect(JSON.parse(screen.getByTestId("scan-preview").getAttribute("data-customization")))
    .toEqual({ version: 1, walls: { color: "#a0afa4", finish: "Matte" } });
  fireEvent.click(screen.getByRole("button", { name: "Export scan + design" }));
  expect(downloadScan).toHaveBeenCalledWith(expect.objectContaining({ mesh: scan.mesh,
    customization: { version: 1, walls: { color: "#a0afa4", finish: "Matte" } } }));
  fireEvent.click(screen.getByRole("button", { name: "Reset finish selections" }));
  expect(screen.getByTestId("scan-preview")).toHaveAttribute("data-customization", "null");
  expect(scan.customization).toBeUndefined();
  expect(screen.getByRole("button", { name: "Export raw scan" })).toBeInTheDocument();
});

test("saving a live reviewed scan reuses its checked mesh", () => {
  render(<PartialScanReview scan={{ mesh: { triangleCount: 12 }, fusionDiagnostics: {},
    captureQuality: { captureAudit: { checkedReconstruction: true } }, rawCapture: { keyframes: [{}] } }} />);
  expect(screen.getByText("Checked scan preview")).toBeInTheDocument();
  expect(createFusionWorker).not.toHaveBeenCalled();
});

test.each([false, true])("an imported or unchecked raw file still goes through reconstruction (mesh: %s)", hasMesh => {
  const worker = { postMessage: jest.fn(), terminate: jest.fn() };
  createFusionWorker.mockReturnValue(worker);
  const { unmount } = render(<PartialScanReview scan={{ rawCapture: { keyframes: [{}], stats: {} },
    ...(hasMesh ? { mesh: { triangleCount: 12 }, fusionDiagnostics: {} } : {}) }} />);
  expect(createFusionWorker).toHaveBeenCalledTimes(1);
  expect(worker.postMessage).toHaveBeenCalled();
  expect(screen.queryByText("Checked scan preview")).not.toBeInTheDocument();
  unmount();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

test.each([48, 49, 50, 51, 52, 53, 54])("a checked raw preview from reconstruction v%s rebuilds surface preparation", version => {
  const worker = { postMessage: jest.fn(), terminate: jest.fn() };
  createFusionWorker.mockReturnValue(worker);
  const { unmount } = render(<PartialScanReview scan={{ mesh: { triangleCount: 12 }, fusionDiagnostics: { algorithmVersion: version },
    captureQuality: { algorithmVersion: version, captureAudit: { checkedReconstruction: true } },
    rawCapture: { keyframes: [{}] } }} />);
  expect(createFusionWorker).toHaveBeenCalledTimes(1);
  expect(worker.postMessage).toHaveBeenCalled();
  expect(screen.queryByText("Checked scan preview")).not.toBeInTheDocument();
  unmount();
});

test("review reports remaining disconnected area without calling every separate object a defect", () => {
  render(<PartialScanReview scan={{ mesh: { triangleCount: 12 },
    captureQuality: { topology: { disconnectedArea: .4, disconnectedComponentCount: 8 } } }} />);
  expect(screen.getByText(/8 surface islands remain/)).toBeInTheDocument();
  expect(screen.getByText(/Separate objects can be legitimate/)).toBeInTheDocument();
});
