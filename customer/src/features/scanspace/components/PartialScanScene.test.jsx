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
jest.mock("./ScanMesh", () => ({
  __esModule: true,
  default: ({ geometryOnly = false }) => <div data-testid="scan-mesh" data-geometry-only={geometryOnly} />,
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
}

function advanceFrame(delta = 0.05) {
  act(() => mockFrame({}, delta));
}

test("the scan opens in walk view with its photo mesh and no view or layer selectors", () => {
  render(<PartialScanScene scan={{ mesh: { bounds, observer: { x: 0, y: 1.6, z: 0.5 } }, cloud: { bounds } }} />);
  expect(screen.getByTestId("scan-mesh")).toHaveAttribute("data-geometry-only", "false");
  expect(screen.queryByTestId("depth-points")).not.toBeInTheDocument();
  for (const name of ["Overview", "Walk inside", "Photo", "Geometry", "Depth points"]) {
    expect(screen.queryByRole("button", { name, exact: true })).not.toBeInTheDocument();
  }
  expect(screen.getByRole("group", { name: "Movement joystick" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reset camera" })).toBeInTheDocument();
  expect(mockCamera.position).toMatchObject({ x: 0, y: 1.6, z: 0.5 });
});

test("a scan without a reconstructed mesh still opens its captured data in walk view", () => {
  walkInside();
  expect(screen.getByTestId("depth-points")).toBeInTheDocument();
  expect(screen.queryByTestId("scan-mesh")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Depth points" })).not.toBeInTheDocument();
  fireEvent.keyDown(window, { code: "KeyW" });
  advanceFrame();
  expect(mockCamera.position.z).toBeLessThan(0.5);
});

test("the compact capture preview also supports walking immediately", () => {
  render(<PartialScanScene compact scan={{ cloud: { bounds, observer: { x: 0, y: 1.6, z: 0.5 } } }} />);
  fireEvent.keyDown(window, { code: "KeyW" });
  advanceFrame();
  expect(mockCamera.position.z).toBeLessThan(0.5);
  expect(screen.getByRole("button", { name: "Move up" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Move down" })).toBeInTheDocument();
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

test("cancel, window blur, and reset clear held movement", () => {
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
});
