import { act } from "react";
import { createRoot, extend } from "@react-three/fiber";
import * as THREE from "three";
import ScanMesh from "./ScanMesh";
import { buildScanDesignSurfaces } from "../core/scanDesignSurfaces";
import { identifyScanSurfaces } from "../core/scanSurfaces";
import { createFloorFinishMaterial, loadFloorFinishMaterial } from "../core/scanFloorMaterial";

jest.mock("../core/scanFloorMaterial", () => {
  const actual = jest.requireActual("../core/scanFloorMaterial");
  return { ...actual, loadFloorFinishMaterial: jest.fn() };
});

extend(THREE);

beforeEach(() => {
  loadFloorFinishMaterial.mockImplementation(selection => Promise.resolve(
    createFloorFinishMaterial(selection, [{ width: 1024, height: 1024 },
      { width: 1024, height: 1024 }, { width: 1024, height: 1024 }])));
});

test("applied finishes attach to mesh groups and survive inspection and reset", async () => {
  const mesh = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1,
      0, 0, 0, 1, 0, 0, 0, 2, 0]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    colors: new Uint8Array(18).fill(255), portableColors: true,
  };
  const surfaces = { labels: new Uint8Array([2, 1]), floorAxes: [[1, 0, 0], [0, 0, 1]] };
  const root = createRoot(document.createElement("canvas"));
  await root.configure({
    gl: { render() {}, setPixelRatio() {}, setSize() {} },
    size: { width: 100, height: 100 }, frameloop: "never",
  });
  let store;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  async function update(customization, geometryOnly = false) {
    await act(async () => {
      store = root.render(<ScanMesh {...{ mesh, surfaces, customization, geometryOnly }} />);
    });
    return store.getState().scene.children[0];
  }
  try {
    let rendered = await update(null);
    expect(rendered.material.isMeshBasicMaterial).toBe(true);
    const customization = { version: 1, walls: { color: "#53665b", finish: "Satin" } };
    rendered = await update(customization);
    expect(Array.isArray(rendered.material)).toBe(true);
    expect(rendered.material[0].isMeshBasicMaterial).toBe(true);
    expect(rendered.material[1].color.getHexString()).toBe("53665b");
    expect(rendered.material[1].roughness).toBe(.5);
    expect(rendered.material[2].isMeshBasicMaterial).toBe(true);
    const design = { ...customization, floor: { finishId: "walnut", direction: "crosswise" },
      ceiling: { color: "#e5d3a4", finish: "Eggshell" } };
    rendered = await update(design);
    expect(rendered.material[2].map.channel).toBe(1);
    expect(rendered.material[2].map.rotation).toBeCloseTo(Math.PI);
    expect(rendered.material[2].normalMap.channel).toBe(1);
    expect(rendered.material[2].roughnessMap.channel).toBe(1);
    expect(rendered.material[2].normalMap.rotation).toBe(rendered.material[2].map.rotation);
    const floorLighting = rendered.material[2].lightMap;
    expect(floorLighting.channel).toBe(2);
    expect(floorLighting.colorSpace).toBe(THREE.NoColorSpace);
    expect(rendered.material[2].toneMapped).toBe(false);
    const lightingUv = rendered.geometry.attributes.uv2.array;
    expect(rendered.material[3].color.getHexString()).toBe("e5d3a4");
    expect(rendered.material[3].roughness).toBe(.78);
    const repainted = { ...design, walls: { color: "#d9b09a", finish: "Matte" } };
    rendered = await update(repainted);
    expect(rendered.material[1].color.getHexString()).toBe("d9b09a");
    expect(rendered.material[1].roughness).toBe(1);
    rendered = await update({ ...repainted, floor: { finishId: "stone", direction: "lengthwise" } });
    expect(rendered.material[2].map.rotation).toBe(0);
    expect(rendered.material[2].lightMap).toBe(floorLighting);
    expect(rendered.geometry.attributes.uv2.array).toBe(lightingUv);
    rendered = await update(repainted, true);
    expect(Array.isArray(rendered.material)).toBe(false);
    expect(rendered.material.color.getHexString()).toBe("b9c2c0");
    rendered = await update(repainted);
    expect(rendered.material[1].color.getHexString()).toBe("d9b09a");
    expect(rendered.geometry.groups.map(group => group.materialIndex)).toEqual([1, 2]);
    rendered = await update(null);
    expect(rendered.material.isMeshBasicMaterial).toBe(true);
    expect(rendered.material.vertexColors).toBe(true);
    expect(rendered.geometry.index.array).toBe(mesh.indices);
    rendered = await update(design);
    expect(rendered.material[2].map.isTexture).toBe(true);
    expect(rendered.material[2].normalMap.channel).toBe(1);
  } finally {
    await act(async () => root.unmount());
    global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

test("late floor selections and failed texture loads keep the current floor or captured photograph", async () => {
  const mesh = { positions: new Float32Array([0,0,0, 1,0,0, 0,0,1]),
    indices: new Uint32Array([0,1,2]), colors: new Uint8Array(9).fill(255), portableColors: true };
  const surfaces = { labels: new Uint8Array([2]), floorAxes: [[1,0,0], [0,0,1]] };
  const photos = [{ width: 1024, height: 1024 }, { width: 1024, height: 1024 }, { width: 1024, height: 1024 }];
  const old = createFloorFinishMaterial({ finishId: "walnut", direction: "lengthwise" }, photos);
  const current = createFloorFinishMaterial({ finishId: "stone", direction: "crosswise" }, photos);
  let resolveOld;
  loadFloorFinishMaterial.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  loadFloorFinishMaterial.mockResolvedValueOnce(current);
  const root = createRoot(document.createElement("canvas"));
  await root.configure({ gl: { render() {}, setPixelRatio() {}, setSize() {} },
    size: { width: 100, height: 100 }, frameloop: "never" });
  const previous = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let store;
  async function update(floor) {
    await act(async () => { store = root.render(<ScanMesh {...{ mesh, surfaces }} customization={floor && { version: 1, floor }} />); });
    return store.getState().scene.children[0].material;
  }
  try {
    let material = await update({ finishId: "walnut", direction: "lengthwise" });
    expect(material[2].isMeshBasicMaterial).toBe(true);
    material = await update({ finishId: "stone", direction: "crosswise" });
    expect(material[2].map).toBe(current.map);
    await act(async () => { resolveOld(old); });
    expect(old.disposed).toBe(true);
    expect(store.getState().scene.children[0].material[2].map).toBe(current.map);
    loadFloorFinishMaterial.mockRejectedValueOnce(new Error("local texture unavailable"));
    material = await update({ finishId: "oak", direction: "lengthwise" });
    expect(current.disposed).toBe(true);
    expect(material[2].isMeshBasicMaterial).toBe(true);
    await update(null);
  } finally {
    await act(async () => { root.unmount(); });
    global.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test("paint and reset use the prepared wall while Geometry retains the measured mesh", async () => {
  const mesh = { positions: new Float32Array([0, 0, .01, 1, 0, .01, 1, 1, .01, 0, 1, .01,
      0,0,.01, 1,0,.01, 1,0,.6, 0,0,.6]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4,6,5, 4,7,6]), colors: new Uint8Array(24).fill(230), portableColors: true };
  mesh.uvs = new Float32Array([0,0, 1,0, 1,1, 0,1, 0,0, 1,0, 1,1, 0,1]);
  mesh.texture = { width: 2, height: 2, data: new Uint8Array(16).fill(255) };
  const planes = [{ kind: "wall", normal: [0, 0, 1], offset: 0 },
    { kind: "floor", normal: [0, 1, 0], offset: 0 }];
  mesh.designSurfaces = buildScanDesignSurfaces(mesh, planes);
  const surfaces = identifyScanSurfaces({ mesh, captureQuality: { structuralDepth: { planes } } });
  const root = createRoot(document.createElement("canvas"));
  await root.configure({ gl: { render() {}, setPixelRatio() {}, setSize() {} }, size: { width: 100, height: 100 }, frameloop: "never" });
  const previous = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let store;
  async function update(customization, geometryOnly = false) {
    await act(async () => { store = root.render(<ScanMesh {...{ mesh, surfaces, customization, geometryOnly }} />); });
    return store.getState().scene;
  }
  try {
    let scene = await update({ version: 1, walls: { color: "#53665b", finish: "Satin" } });
    let wall = scene.getObjectByName("prepared-wall");
    expect(wall.geometry.attributes.position.array).toBe(mesh.designSurfaces.walls[0].positions);
    expect(wall.material.color.getHexString()).toBe("53665b");
    expect(wall.material.roughness).toBe(.5);
    expect(wall.material.onBeforeCompile).not.toBe(THREE.Material.prototype.onBeforeCompile);
    const lightingTexture = wall.material.lightMap;
    expect(lightingTexture).not.toBeNull();
    expect(lightingTexture.colorSpace).toBe(THREE.NoColorSpace);
    expect(wall.material.toneMapped).toBe(false);
    expect(wall.material.side).toBe(THREE.FrontSide);
    const back = scene.getObjectByName("prepared-wall-back");
    expect(back.material.side).toBe(THREE.BackSide);
    expect(back.material.map).toBeNull();
    const joins = scene.getObjectByName("captured-boundary-details");
    expect(mesh.designSurfaces.diagnostics.boundaryAdjustedSourceTriangles).toBeGreaterThan(0);
    expect(joins.geometry.groups.map(group => group.materialIndex)).toEqual([2]);
    expect(joins.geometry.attributes.uv.array).toBe(mesh.designSurfaces.fragments.uvs);
    expect(joins.material[2].map).not.toBeNull();
    expect(joins.material[2].isMeshBasicMaterial).toBe(true);
    scene = await update({ version: 1, walls: { color: "#53665b", finish: "Satin" },
      floor: { finishId: "walnut", direction: "crosswise" } });
    const floorEdge = scene.getObjectByName("captured-boundary-details");
    expect(floorEdge.material[2].map.channel).toBe(1);
    expect(floorEdge.material[2].map.rotation).toBeCloseTo(Math.PI);
    expect(floorEdge.geometry.attributes.uv.array).toBe(mesh.designSurfaces.fragments.uvs);
    const primaryFloor = floorEdge.parent.children[0];
    expect(floorEdge.material[2].lightMap).toBe(primaryFloor.material[2].lightMap);
    expect(floorEdge.material[2].lightMap.channel).toBe(2);
    expect(floorEdge.geometry.attributes.uv2).toBeDefined();
    expect(scene.getObjectByName("prepared-wall").material.lightMap).toBe(lightingTexture);
    scene = await update(null);
    wall = scene.getObjectByName("prepared-wall");
    expect(wall.material.isMeshBasicMaterial).toBe(true);
    expect(wall.material.map).not.toBeNull();
    expect(wall.material.map).not.toBe(lightingTexture);
    expect(wall.material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(wall.material.side).toBe(THREE.FrontSide);
    const resetEdge = scene.getObjectByName("captured-boundary-details");
    expect(resetEdge.material.isMeshBasicMaterial).toBe(true);
    expect(resetEdge.material.map).not.toBeNull();
    expect(resetEdge.material.vertexColors).toBe(true);
    scene = await update(null, true);
    expect(scene.getObjectByName("prepared-wall")).toBeUndefined();
    expect(scene.getObjectByName("prepared-wall-back")).toBeUndefined();
    expect(scene.getObjectByName("captured-boundary-details")).toBeUndefined();
    expect(scene.children[0].geometry.index.array).toBe(mesh.indices);
    expect(scene.children[0].geometry.attributes.position.array).toBe(mesh.positions);
  } finally {
    await act(async () => root.unmount()); global.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});

test("prepared ceilings accept finishes while Geometry keeps the complete captured mesh", async () => {
  const mesh = {
    positions: new Float32Array([0, 2.6, 0, 1.2, 2.6, 0, 1.2, 2.6, 1.2, 0, 2.6, 1.2]),
    normals: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0]),
    colors: new Uint8Array(12).fill(180), indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    floorY: 0, portableColors: true,
  };
  const frames = [0, 1, 2].map(frameId => ({
    frameId, camera: [frameId * .12, 1, .6],
    transformMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, frameId * .12, 1, .6, 1]),
    columns: 30, rows: 30, colorImage: new Uint8Array(64).fill(180), colorWidth: 4, colorHeight: 4,
    measuredMask: new Uint8Array(900).fill(1), filteredDepth: new Float32Array(900).fill(1.6),
  }));
  mesh.designSurfaces = buildScanDesignSurfaces(mesh, [], frames, {
    project: (f, x, y, z) => ({ u: (x + .1) / 1.4, v: (z + .1) / 1.4, depth: y - 1 }),
    unproject: (f, i, d) => [(i % 30 + .5) * .04, 1 + d, (Math.floor(i / 30) + .5) * .04],
    sampleColor: () => [180, 180, 170],
  });
  expect(mesh.designSurfaces.ceilings).toHaveLength(1);
  const root = createRoot(document.createElement("canvas"));
  await root.configure({ gl: { render() {}, setPixelRatio() {}, setSize() {} },
    size: { width: 100, height: 100 }, frameloop: "never" });
  const previous = global.IS_REACT_ACT_ENVIRONMENT;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let store;
  async function update(customization, geometryOnly = false) {
    await act(async () => { store = root.render(<ScanMesh {...{ mesh, customization, geometryOnly }} />); });
    return store.getState().scene;
  }
  try {
    let scene = await update(null), ceiling = scene.getObjectByName("prepared-ceiling");
    expect(ceiling.material.map).not.toBeNull();
    expect(ceiling.material.side).toBe(THREE.FrontSide);
    expect(scene.getObjectByName("prepared-ceiling-back")).toBeUndefined();
    scene = await update({ version: 1, ceiling: { color: "#e5d3a4", finish: "Eggshell" } });
    expect(scene.getObjectByName("prepared-ceiling").material.color.getHexString()).toBe("e5d3a4");
    scene = await update(null, true);
    expect(scene.getObjectByName("prepared-ceiling")).toBeUndefined();
    expect(scene.children[0].geometry.attributes.position.array).toBe(mesh.positions);
    expect(scene.children[0].material.clippingPlanes).toBeNull();
  } finally {
    await act(async () => root.unmount());
    global.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
