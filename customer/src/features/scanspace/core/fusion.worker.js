/* eslint-disable no-restricted-globals */
import { fuseRgbdKeyframes } from "./fusion";

self.onmessage = (event) => {
  try {
    const result = fuseRgbdKeyframes(event.data.keyframes || [], event.data.options || {}, (stage, progress, diagnostics) =>
      self.postMessage({ type: "progress", stage, progress, diagnostics }),
    );
    const transfer = result.mesh
      ? [
          result.mesh.positions,
          result.mesh.normals,
          result.mesh.colors,
          result.mesh.uvs,
          result.mesh.indices,
          result.mesh.texture?.data,
        ]
          .filter(Boolean)
          .map((value) => value.buffer)
      : [];
    self.postMessage({ type: "complete", result }, transfer);
  } catch (error) {
    self.postMessage({ type: "error", error: error.message || "RGB-D fusion failed." });
  }
};
