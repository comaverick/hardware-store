// Replay a raw capture with the working tree or an immutable Git revision.
// Usage: node scripts/inspect-scanspace-result.cjs <capture.json> <output-dir> [revision] [--checkpoints]
// Binary mesh artifacts support reproducible visual comparisons without
// modifying the input or adding camera images to the repository.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { serialize } = require('node:v8');
const babel = require('@babel/core');

const workspace = path.resolve(__dirname, '..');
const [capturePath, outputPath, ...extra] = process.argv.slice(2);
const revision = extra.find(value => !value.startsWith('--'));
const checkpoints = extra.includes('--checkpoints');
if (!capturePath || !outputPath) {
  throw new Error('Usage: inspect-scanspace-result.cjs <capture.json> <output-dir> [revision]');
}
const output = path.resolve(outputPath);
const input = path.resolve(capturePath);
if (input === output || input.startsWith(output + path.sep))
  throw new Error('Output must be separate from the input capture.');
const gitRoot = revision && execFileSync('git', ['rev-parse', '--show-toplevel'],
  { cwd: workspace, encoding: 'utf8' }).trim();
const cache = new Map();
const saveCheckpoint = (name, mesh, planes, frames, options) => {
  fs.mkdirSync(output, { recursive: true });
  // Camera photographs are not needed for local topology replay.
  const geometryFrames = frames.map(frame => Object.fromEntries(Object.entries(frame)
    .filter(([key]) => !['colorImage', 'colorCandidates'].includes(key))));
  fs.writeFileSync(path.join(output, `${name}.v8`), serialize({ mesh, planes, frames: geometryFrames, options }));
};
function load(file) {
  file = path.resolve(workspace, file);
  if (cache.has(file)) return cache.get(file).exports;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  cache.set(file, loaded);
  loaded.require = id => id.startsWith('.')
    ? load(require.resolve(path.resolve(path.dirname(file), id))) : require(id);
  const source = revision
    ? execFileSync('git', ['show', `${revision}:${path.relative(gitRoot, file).split(path.sep).join('/')}`],
      { cwd: workspace, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    : fs.readFileSync(file, 'utf8');
  loaded._compile(babel.transformSync(source, {
    plugins: ['@babel/plugin-transform-modules-commonjs'], babelrc: false, configFile: false,
  }).code, file);
  return loaded.exports;
}

const { parsePartialScan } = load('src/features/scanspace/core/partialScanFile.js');
const { scanFusionOptions } = load('src/features/scanspace/core/fusionOptions.js');
if (checkpoints) {
  // Wrap this inspection process's export before fusion loads it. Application
  // files remain unchanged; prepared Maps and typed arrays survive local replay.
  const structural = load('src/features/scanspace/core/structuralSurface.js');
  const rebuild = structural.rebuildStructuralSurfaces;
  structural.rebuildStructuralSurfaces = (mesh, planes, frames, helpers, options) => {
    saveCheckpoint('before-rebuild', mesh, planes, frames, options);
    const candidate = rebuild(mesh, planes, frames, helpers, options);
    saveCheckpoint('after-rebuild', candidate, planes, frames, options);
    return candidate;
  };
}
const { fuseRgbdKeyframes } = load('src/features/scanspace/core/fusion.js');
const captureBytes = fs.readFileSync(input);
const captureSha256 = createHash('sha256').update(captureBytes).digest('hex');
const scan = parsePartialScan(captureBytes.toString('utf8'));
if (!scan.rawCapture) throw new Error('A raw RGB-D capture is required.');
const start = Date.now();
let lastStage;
const stageTimes = [];
const result = fuseRgbdKeyframes(scan.rawCapture.keyframes,
  scanFusionOptions(scan.rawCapture, 'surface'), (stage, percent) => {
    if (stage !== lastStage) {
      stageTimes.push({ stage, elapsedSeconds: (Date.now() - start) / 1000 });
      console.log(`${stage}: ${percent}%`);
    }
    lastStage = stage;
  });
fs.mkdirSync(output, { recursive: true });
const report = { revision: revision || 'working-tree', captureSha256, stageTimes,
  elapsedSeconds: (Date.now() - start) / 1000, diagnostics: result.diagnostics };
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
if (!result.mesh) throw new Error(result.diagnostics.reason || 'No reconstructed mesh.');
const mesh = result.mesh;
const manifest = { bounds: mesh.bounds, vertexCount: mesh.vertexCount,
  triangleCount: mesh.triangleCount, attributes: {} };
for (const name of ['positions', 'indices', 'colors', 'uvs', 'normals', 'estimatedTriangleMask']) {
  const values = mesh[name];
  if (!values?.length) continue;
  const filename = `${name}.bin`;
  fs.writeFileSync(path.join(output, filename),
    Buffer.from(values.buffer, values.byteOffset, values.byteLength));
  manifest.attributes[name] = { file: filename, type: values.constructor.name, length: values.length };
}
if (mesh.texture?.data) {
  fs.writeFileSync(path.join(output, 'texture.rgba'), Buffer.from(mesh.texture.data));
  manifest.texture = { file: 'texture.rgba', width: mesh.texture.width, height: mesh.texture.height };
}
fs.writeFileSync(path.join(output, 'mesh.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ revision: report.revision, elapsedSeconds: report.elapsedSeconds,
  frames: result.diagnostics.keyframes, triangles: mesh.triangleCount,
  structuralRebuild: result.diagnostics.structuralRebuild,
  topology: result.diagnostics.topologyAfterRepair,
  surfaceEvidence: result.diagnostics.surfaceEvidence,
  output }, null, 2));
