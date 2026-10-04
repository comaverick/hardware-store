import { alignFinishedScan, planesForScanMesh } from "./scanCoordinates";
import { buildScanDesignSurfaces, getScanDesignSurfaces, validScanDesignSurfaces } from "./scanDesignSurfaces";
import { identifyScanSurfaces } from "./scanSurfaces";

test.each([-.27, .6])("finished geometry, prepared walls and plane equations share the floor translation (%s)", floorY => {
  const mesh = { positions: new Float32Array([0,floorY,0, 1,floorY,0, 1,floorY+2,0, 0,floorY+2,0,
    0,floorY,0, 1,floorY,0, 1,floorY,1, 0,floorY,1]),
    indices: new Uint32Array([0,1,2, 0,2,3, 4,6,5, 4,7,6]),
    bounds: {min:{x:0,y:floorY,z:0},max:{x:1,y:floorY+2,z:1}} };
  const planes = [{kind:"wall",normal:[0,0,1],offset:0}, {kind:"floor",normal:[0,1,0],offset:floorY}];
  mesh.designSurfaces = buildScanDesignSurfaces(mesh, planes);
  mesh.planarConsolidation = {planes};
  const positions = mesh.positions.slice(), wallPositions = mesh.designSurfaces.walls[0].positions.slice();
  const finished = alignFinishedScan(mesh, {structuralDepth:{planes},planarConsolidation:{planes}}, floorY);
  expect(finished.mesh.bounds.min.y).toBe(0);
  expect(finished.diagnostics.structuralDepth.planes[1].offset).toBe(0);
  expect(finished.mesh.planarConsolidation.planes[1].offset).toBe(0);
  expect(getScanDesignSurfaces(finished.mesh)).toBe(finished.mesh.designSurfaces);
  expect(validScanDesignSurfaces(finished.mesh.designSurfaces, finished.mesh)).toBe(true);
  const scan = {mesh:finished.mesh, rawCapture:{floorY},captureQuality:finished.diagnostics};
  expect(Array.from(identifyScanSurfaces(scan).labels).slice(-2)).toEqual([2,2]);
  expect(planesForScanMesh(scan, finished.diagnostics.structuralDepth)[1].offset).toBe(0);
  expect(mesh.positions).toEqual(positions);
  expect(mesh.designSurfaces.walls[0].positions).toEqual(wallPositions);
  expect(planes[1].offset).toBe(floorY);
});

test("legacy capture-space plane diagnostics target translated portable geometry exactly once", () => {
  const plane = {kind:"floor",normal:[0,.9950371902,.099503719],offset:-.269};
  const scan = {mesh:{floorY:-.27},cloud:{floorY:-.27}};
  const group = {planes:[plane]};
  const updated = planesForScanMesh(scan, group);
  expect(updated[0].offset).toBeCloseTo(-.269 + .27 * plane.normal[1]);
  expect(planesForScanMesh(scan, {planes:updated,coordinateMode:"floor-aligned-v1"})).toBe(updated);
  expect(plane.offset).toBe(-.269);
});
