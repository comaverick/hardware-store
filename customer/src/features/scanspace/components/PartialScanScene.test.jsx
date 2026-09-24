import { fireEvent, render, screen } from "@testing-library/react";
import PartialScanScene from "./PartialScanScene";

jest.mock("@react-three/fiber", () => ({
  Canvas: ({ children }) => {
    const React = require("react");
    return <div>{React.Children.toArray(children).filter(child => typeof child.type !== "string")}</div>;
  },
  useFrame: () => {},
  useThree: () => ({
    camera: { position: { set: () => {} }, lookAt: () => {}, rotation: {} },
    gl: { domElement: {} },
  }),
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

test("unconnected areas can be inspected independently", () => {
  render(<PartialScanScene scan={{ mesh: { bounds }, cloud: { bounds },
    sections: [{ id: 4, label: "Area 2", cloud: { bounds } }] }} />);
  expect(screen.getByRole("group", { name: "Captured areas" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Area 2" }));
  expect(screen.getByTestId("depth-points")).toBeInTheDocument();
  expect(screen.getByText(/shown separately until their depth connection is verified/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Area 1" }));
  expect(screen.getByTestId("scan-mesh")).toBeInTheDocument();
});
