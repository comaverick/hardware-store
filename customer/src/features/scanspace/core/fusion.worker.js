/* eslint-disable no-restricted-globals */
import { fuseRgbdKeyframes } from "./fusion";

self.onmessage = (event) => {
  try {
    const result = fuseRgbdKeyframes(event.data.keyframes || [], event.data.options || {}, (stage, progress, diagnostics) =>
      self.postMessage({ type: "progress", stage, progress, diagnostics }),
    );
    const transfer = [
      ...(result.mesh
        ? [
          result.mesh.positions,
          result.mesh.normals,
          result.mesh.colors,
          result.mesh.uvs,
          result.mesh.indices,
          result.mesh.texture?.data,
        ]
        : []),
      result.observations?.positions,
      result.observations?.colors,
      result.observations?.colorMask,
      result.mesh?.designSurfaces?.removedSourceFaces,
      ...Object.values(result.mesh?.designSurfaces?.fragments || {}).filter(ArrayBuffer.isView),
      ...(result.mesh?.designSurfaces?.walls || []).flatMap(wall => [
        wall.positions, wall.normals, wall.colors, wall.uvs, wall.indices,
        wall.estimatedTriangleMask, wall.texture?.data, wall.detailMask, wall.footprint, wall.openingMask,
      ]),
    ]
      .filter(Boolean)
      .map((value) => value.buffer);
    self.postMessage({ type: "complete", result }, [...new Set(transfer)]);
  } catch (error) {
    self.postMessage({ type: "error", error: error.message || "RGB-D fusion failed." });
  }
};
