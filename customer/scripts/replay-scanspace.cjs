// Reconstruct a raw export using the application's parser and shared options.
// Usage: node scripts/replay-scanspace.cjs <raw-scan.json>
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

if (!process.argv[2]) {
  console.error("Usage: node scripts/replay-scanspace.cjs <raw-scan.json>");
  process.exitCode = 1;
} else {
  const { parsePartialScan } = load("src/features/scanspace/core/partialScanFile.js");
  const { scanFusionOptions } = load("src/features/scanspace/core/fusionOptions.js");
  const { fuseRgbdKeyframes } = load("src/features/scanspace/core/fusion.js");
  const scan = parsePartialScan(fs.readFileSync(path.resolve(process.argv[2]), "utf8"));
  if (!scan.rawCapture) throw new Error("A raw RGB-D export is required.");
  const start = Date.now();
  const result = fuseRgbdKeyframes(scan.rawCapture.keyframes, scanFusionOptions(scan.rawCapture));
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
    settings: d.fusionSettings,
  }, null, 2));
  if (!mesh) process.exitCode = 1;
}
