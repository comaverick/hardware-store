import { act, fireEvent, render, screen } from "@testing-library/react";
import { useFrame } from "@react-three/fiber";
import PartialScanScene from "./PartialScanScene";

let mockCamera;
let mockGl;
let mockFrame;

jest.mock("@react-three/fiber", () => ({
  Canvas: ({ children }) => {
    const React = require("react");
    return <div>{React.Children.toArray(children).filter(child => typeof child.type !== "string")}</div>;
  },
  useFrame: jest.fn(),
  useThree: () => ({ camera: mockCamera, gl: mockGl }),
}));
jest.mock("@react-three/drei", () => ({ OrbitControls: () => null }));
jest.mock("./ScanMesh", () => ({
  __esModule: true,
  default: ({ geometryOnly }) => <div data-testid="scan-mesh" data-geometry-only={geometryOnly} />,
}));
jest.mock("./ScanPointCloud", () => ({
  __esModule: true,
  default: () => <div data-testid="depth-points" />,
}));

const bounds = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } };

beforeEach(() => {
  mockCamera = {
    position: {
      x: 0, y: 0, z: 0,
      set(x, y, z) { Object.assign(this, { x, y, z }); },
    },
    lookAt: jest.fn(),
    rotation: { set: jest.fn() },
  };
  mockGl = { domElement: document.createElement("canvas") };
  useFrame.mockImplementation((callback) => { mockFrame = callback; });
});

function walkInside() {
  render(<PartialScanScene scan={{ cloud: { bounds, observer: { x: 0, y: 1.6, z: 0.5 } } }} />);
  fireEvent.click(screen.getByRole("button", { name: "Walk inside" }));
}

function advanceFrame(delta = 0.05) {
  act(() => mockFrame({}, delta));
}

test("the same scan can be inspected as photo, geometry, or depth points", () => {
  render(<PartialScanScene scan={{ mesh: { bounds }, cloud: { bounds } }} />);
  expect(screen.getByTestId("scan-mesh")).toHaveAttribute("data-geometry-only", "false");
  fireEvent.click(screen.getByRole("button", { name: "Geometry" }));
  expect(screen.getByTestId("scan-mesh")).toHaveAttribute("data-geometry-only", "true");
  fireEvent.click(screen.getByRole("button", { name: "Depth points" }));
  expect(screen.getByTestId("depth-points")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Photo" }));
  expect(screen.getByTestId("scan-mesh")).toHaveAttribute("data-geometry-only", "false");
});

test("depth inspection is unavailable without captured points", () => {
  render(<PartialScanScene scan={{ mesh: { bounds } }} />);
  expect(screen.getByRole("button", { name: "Depth points" })).toBeDisabled();
});

test("holding the height buttons moves vertically and stops on release or lost capture", () => {
  walkInside();
  const up = screen.getByRole("button", { name: "Move up" });
  const down = screen.getByRole("button", { name: "Move down" });
  fireEvent.pointerDown(up);
  advanceFrame();
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.735);
  expect(mockCamera.position.x).toBe(0);
  expect(mockCamera.position.z).toBe(0.5);
  fireEvent.pointerUp(up);
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.735);

  fireEvent.pointerDown(down);
  advanceFrame();
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.6);
  fireEvent.lostPointerCapture(down);
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.6);
});

test("Q and E change height, release stops movement, and typing does not move the camera", () => {
  walkInside();
  render(<input aria-label="Room name" />);
  const name = screen.getByRole("textbox", { name: "Room name" });
  fireEvent.keyDown(name, { code: "KeyQ" });
  advanceFrame();
  expect(mockCamera.position.y).toBe(1.6);

  fireEvent.keyDown(window, { code: "KeyQ" });
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.6675);
  fireEvent.keyUp(name, { code: "KeyQ" });
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.6675);
  fireEvent.keyDown(window, { code: "KeyE" });
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.6);
  fireEvent.keyUp(window, { code: "KeyE" });
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.6);
});

test("height buttons also support holding Enter or Space with keyboard focus", () => {
  walkInside();
  const up = screen.getByRole("button", { name: "Move up" });
  const down = screen.getByRole("button", { name: "Move down" });
  fireEvent.keyDown(up, { key: "Enter", code: "Enter" });
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.6675);
  fireEvent.keyUp(up, { key: "Enter", code: "Enter" });
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.6675);
  fireEvent.keyDown(down, { key: " ", code: "Space" });
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.6);
  fireEvent.blur(down);
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(1.6);
});

test("vertical movement stays within the scan's padded height bounds", () => {
  walkInside();
  mockCamera.position.y = bounds.max.y + 0.69;
  fireEvent.pointerDown(screen.getByRole("button", { name: "Move up" }));
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(bounds.max.y + 0.7);
  fireEvent.pointerUp(screen.getByRole("button", { name: "Move up" }));
  mockCamera.position.y = bounds.min.y - 0.69;
  fireEvent.pointerDown(screen.getByRole("button", { name: "Move down" }));
  advanceFrame();
  expect(mockCamera.position.y).toBeCloseTo(bounds.min.y - 0.7);
});

test("forward and vertical movement combine without increasing movement speed", () => {
  walkInside();
  fireEvent.keyDown(window, { code: "KeyW" });
  fireEvent.keyDown(window, { code: "KeyQ" });
  advanceFrame();
  expect(mockCamera.position.y).toBeGreaterThan(1.6);
  expect(mockCamera.position.z).toBeLessThan(0.5);
  expect(Math.hypot(mockCamera.position.y - 1.6, mockCamera.position.z - 0.5)).toBeCloseTo(0.0675);
});

test("cancel, window blur, reset, and changing view clear held movement", () => {
  walkInside();
  const up = screen.getByRole("button", { name: "Move up" });
  fireEvent.pointerDown(up);
  fireEvent.pointerCancel(up);
  advanceFrame();
  expect(mockCamera.position.y).toBe(1.6);

  fireEvent.pointerDown(up);
  fireEvent.keyDown(window, { code: "KeyQ" });
  fireEvent.blur(window);
  advanceFrame();
  expect(mockCamera.position.y).toBe(1.6);

  fireEvent.pointerDown(up);
  advanceFrame();
  fireEvent.click(screen.getByRole("button", { name: "Reset camera" }));
  advanceFrame();
  expect(mockCamera.position.y).toBe(1.6);

  fireEvent.pointerDown(up);
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  expect(screen.queryByRole("button", { name: "Move up" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Walk inside" }));
  advanceFrame();
  expect(mockCamera.position.y).toBe(1.6);
});
