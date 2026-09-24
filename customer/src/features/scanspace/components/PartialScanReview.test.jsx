import { act, render, screen } from "@testing-library/react";
import PartialScanReview from "./PartialScanReview";
import { createFusionWorker } from "../core/createFusionWorker";

jest.mock("../core/createFusionWorker", () => ({ createFusionWorker: jest.fn() }));
jest.mock("./PartialScanScene", () => ({ __esModule: true, default: () => <div>Checked scan preview</div> }));

beforeEach(() => jest.clearAllMocks());

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

test("an imported raw file sends each saved area to reconstruction independently", () => {
  const worker = { postMessage: jest.fn(), terminate: jest.fn() };
  createFusionWorker.mockReturnValue(worker);
  const sections = [{ id: 9, keyframes: [{}, {}] }];
  render(<PartialScanReview scan={{ rawCapture: { keyframes: [{}], provisionalSegments: sections,
    stats: {} } }} />);
  expect(worker.postMessage.mock.calls[0][0].sections).toBe(sections);
});

test("an imported separate area remains reviewable when Area 1 has no mesh", () => {
  const worker = { postMessage: jest.fn(), terminate: jest.fn() };
  createFusionWorker.mockReturnValue(worker);
  const emptyFrame = { positions: new Float32Array(), depths: new Float32Array() };
  render(<PartialScanReview scan={{ rawCapture: { keyframes: [emptyFrame],
    provisionalSegments: [{ id: 9, keyframes: [emptyFrame, emptyFrame] }], stats: {} } }} />);
  act(() => worker.onmessage({ data: { type: "complete", result: { mesh: null, diagnostics: {},
    sections: [{ id: 9, mesh: { triangleCount: 5 }, diagnostics: {} }] } } }));
  expect(screen.getByText("Checked scan preview")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue with Area 2 measurements" })).toBeInTheDocument();
});

test("review reports remaining disconnected area without calling every separate object a defect", () => {
  render(<PartialScanReview scan={{ mesh: { triangleCount: 12 },
    captureQuality: { topology: { disconnectedArea: .4, disconnectedComponentCount: 8 } } }} />);
  expect(screen.getByText(/8 surface islands remain/)).toBeInTheDocument();
  expect(screen.getByText(/Separate objects can be legitimate/)).toBeInTheDocument();
});
