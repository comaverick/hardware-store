/* eslint-disable no-restricted-globals */
import { fuseRgbdKeyframes } from "./fusion";

self.onmessage = (event) => {
  try {
    const result = fuseRgbdKeyframes(event.data.keyframes || [], event.data.options || {}, (stage, progress, diagnostics) =>
      self.postMessage({ type: "progress", stage, progress, diagnostics }),
    );
    result.sections = (event.data.sections || []).map((section, index) => {
      try {
        return { id: section.id,
          ...fuseRgbdKeyframes(section.keyframes || [], {
            ...(event.data.options || {}), textureKeyframes: [], headingCoverage: 0,
            recoverCaptureGroups: false,
          }, (stage, progress, diagnostics) =>
            self.postMessage({ type: "progress", stage: `area ${index + 2}: ${stage}`, progress, diagnostics })) };
      } catch (error) {
        return { id: section.id, mesh: null, observations: null,
          diagnostics: { reason: error.message || "This separate area could not be reconstructed." } };
      }
    });
    const transfer = [...new Set([result, ...result.sections].flatMap(sectionResult => [
      ...(sectionResult.mesh
        ? [
          sectionResult.mesh.positions,
          sectionResult.mesh.normals,
          sectionResult.mesh.colors,
          sectionResult.mesh.uvs,
          sectionResult.mesh.indices,
          sectionResult.mesh.texture?.data,
        ]
        : []),
      sectionResult.observations?.positions,
      sectionResult.observations?.colors,
      sectionResult.observations?.colorMask,
    ])
      .filter(Boolean)
      .map((value) => value.buffer))];
    self.postMessage({ type: "complete", result }, transfer);
  } catch (error) {
    self.postMessage({ type: "error", error: error.message || "RGB-D fusion failed." });
  }
};
