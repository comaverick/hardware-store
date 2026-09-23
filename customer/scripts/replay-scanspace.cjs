// Reconstruct a raw export using the application's parser and shared options.
// Usage: node scripts/replay-scanspace.cjs <raw-scan.json> [key=value ...]
// No capture files or application sources are modified.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const babel = require("@babel/core");

const cache = new Map();
function load(file) {
  file = path.resolve(__dirname, "..", file);
  if (cache.has(file)) return cache.get(file).exports;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  cache.set(file, loaded);
  loaded.require = (id) => id.startsWith(".")
    ? load(require.resolve(path.resolve(path.dirname(file), id))) : require(id);
  loaded._compile(babel.transformSync(fs.readFileSync(file, "utf8"), {
    plugins: ["@babel/plugin-transform-modules-commonjs"], babelrc: false, configFile: false,
  }).code, file);
  return loaded.exports;
}

module.exports = { load };

if (require.main !== module) {
  // The visual regression runner uses the same application-module loader.
} else if (!process.argv[2]) {
  console.error("Usage: node scripts/replay-scanspace.cjs <raw-scan.json>");
  process.exitCode = 1;
} else {
  const { parsePartialScan } = load("src/features/scanspace/core/partialScanFile.js");
  const { scanFusionOptions } = load("src/features/scanspace/core/fusionOptions.js");
  const { fuseRgbdKeyframes } = load("src/features/scanspace/core/fusion.js");
  const scan = parsePartialScan(fs.readFileSync(path.resolve(process.argv[2]), "utf8"));
  if (!scan.rawCapture) throw new Error("A raw RGB-D export is required.");
  const overrides = Object.fromEntries(process.argv.slice(3).filter(arg => arg.includes("=")).map(arg => {
    const [key, ...value] = arg.split("=");
    const raw = value.join("=");
    try { return [key, JSON.parse(raw)]; } catch { return [key, raw]; }
  }));
  const start = Date.now();
  const result = fuseRgbdKeyframes(scan.rawCapture.keyframes,
    scanFusionOptions(scan.rawCapture, "surface", overrides));
  const d = result.diagnostics, mesh = result.mesh;
  console.log(JSON.stringify({
    elapsedSeconds: (Date.now() - start) / 1000,
    algorithmVersion: d.algorithmVersion, reason: d.reason,
    frames: d.keyframes, voxelSize: d.voxelSize,
    triangles: mesh?.triangleCount, textureCoverage: mesh?.textureCoverage,
    atlas: mesh?.texture ? [mesh.texture.width, mesh.texture.height] : null,
    area: d.surfaceArea, bounds: mesh?.bounds,
    planar: d.planarConsolidation, denoising: d.denoising,
    pose: d.alignment?.poseRefinementDiagnostics ? {
      ...d.alignment.poseRefinementDiagnostics,
      corrections: process.argv.includes("--poses") ? d.alignment.poseRefinementDiagnostics.corrections : undefined,
    } : null,
    synchronizedTextureFrames: d.alignment?.synchronizedTextureFrames,
    softTextureTriangles: d.softTextureFallbackTriangles,
    untexturedEstimatedTriangles: d.untexturedEstimatedTriangles,
    structuralDepth: d.structuralDepth && {
      correctedSamples: d.structuralDepth.correctedSamples,
      maxDisplacementMeters: d.structuralDepth.maxDisplacementMeters,
      rejectedLargeCorrections: d.structuralDepth.rejectedLargeCorrections,
      planes: d.structuralDepth.planes?.map(plane => ({ kind: plane.kind, area: plane.area,
        views: plane.supportingFrameIds?.length })),
    },
    structuralRebuild: d.structuralRebuild && {
      reconstructedArea: d.structuralRebuild.reconstructedArea,
      removedCompetingTriangles: d.structuralRebuild.removedCompetingTriangles,
      reverted: d.structuralRebuild.reverted || false,
      revertReasons: d.structuralRebuild.revertReasons || [],
    },
    structuralRebuildValidation: d.structuralRebuildValidation && {
      accepted: d.structuralRebuildValidation.accepted,
      before: {
        disconnectedArea: d.structuralRebuildValidation.before.disconnectedArea,
        nonManifoldEdges: d.structuralRebuildValidation.before.nonManifoldEdges,
      },
      after: {
        disconnectedArea: d.structuralRebuildValidation.after.disconnectedArea,
        nonManifoldEdges: d.structuralRebuildValidation.after.nonManifoldEdges,
      },
    },
    topology: d.topologyAfterRepair && {
      nonManifoldEdges: d.topologyAfterRepair.nonManifoldEdges,
      windingConflicts: d.topologyAfterRepair.windingConflicts,
      disconnectedArea: d.topologyAfterRepair.disconnectedArea,
      dominantComponentAreaRatio: d.topologyAfterRepair.dominantComponentAreaRatio,
    },
    settings: d.fusionSettings,
  }, null, 2));
  if (!mesh) process.exitCode = 1;
}
