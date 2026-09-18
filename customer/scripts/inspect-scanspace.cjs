// CPU render of the production mesh. No browser, GPU, or source scan mutation.
// Usage: node scripts/inspect-scanspace.cjs scan.json output-directory [key=value ...]
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const v8 = require('node:v8');
const THREE = require('three');
const {
  load
} = require('./replay-scanspace.cjs');
const {
  parseScanFile
} = load('src/features/scanspace/core/partialScanFile.js');
const {
  scanFusionOptions
} = load('src/features/scanspace/core/fusionOptions.js');
const {
  fuseRgbdKeyframes
} = load('src/features/scanspace/core/fusion.js');
function writePng(file, width, height, data) {
  const crc = buffer => {
    let n = -1;
    for (const byte of buffer) {
      n ^= byte;
      for (let j = 0; j < 8; j++) n = n >>> 1 ^ (n & 1 ? 0xedb88320 : 0);
    }
    return (n ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    payload.copy(out, 4);
    out.writeUInt32BE(crc(payload), out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}
function render(mesh, camera, file, plain = false, width = 1000, height = 750) {
  camera.updateMatrixWorld();
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  const positions = mesh.positions,
    screen = new Float64Array(positions.length / 3 * 4);
  for (let i = 0; i < positions.length / 3; i++) {
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2];
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    screen[i * 4] = ((matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w * 0.5 + 0.5) * width;
    screen[i * 4 + 1] = (0.5 - (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w * 0.5) * height;
    screen[i * 4 + 2] = (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w;
    screen[i * 4 + 3] = 1 / w;
  }
  const rgba = new Uint8Array(width * height * 4),
    depth = new Float64Array(width * height).fill(Infinity);
  for (let i = 0; i < depth.length; i++) rgba.set([24, 33, 30, 255], i * 4);
  const edge = (a, b, x, y) => (x - screen[a * 4]) * (screen[b * 4 + 1] - screen[a * 4 + 1]) - (y - screen[a * 4 + 1]) * (screen[b * 4] - screen[a * 4]);
  const toSrgb = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const toLinear = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const tex = mesh.texture;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ids = Array.from(mesh.indices.subarray(t, t + 3));
    if (ids.some(i => screen[i * 4 + 3] <= 0 || screen[i * 4 + 2] < -1)) continue;
    const [a, b, c] = ids,
      area = edge(a, b, screen[c * 4], screen[c * 4 + 1]);
    if (Math.abs(area) < 1e-7) continue;
    const minX = Math.max(0, Math.floor(Math.min(...ids.map(i => screen[i * 4])))),
      maxX = Math.min(width - 1, Math.ceil(Math.max(...ids.map(i => screen[i * 4]))));
    const minY = Math.max(0, Math.floor(Math.min(...ids.map(i => screen[i * 4 + 1])))),
      maxY = Math.min(height - 1, Math.ceil(Math.max(...ids.map(i => screen[i * 4 + 1]))));
    const ab = new THREE.Vector3().fromArray(positions, b * 3).sub(new THREE.Vector3().fromArray(positions, a * 3));
    const ac = new THREE.Vector3().fromArray(positions, c * 3).sub(new THREE.Vector3().fromArray(positions, a * 3));
    const normal = ab.cross(ac).normalize();
    const light = 0.4 + 0.6 * Math.abs(normal.dot(new THREE.Vector3(0.3, 0.8, 0.5).normalize()));
    const facing = normal.dot(camera.position.clone().sub(new THREE.Vector3().fromArray(positions, a * 3)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const weights = [edge(b, c, x + 0.5, y + 0.5) / area, edge(c, a, x + 0.5, y + 0.5) / area, edge(a, b, x + 0.5, y + 0.5) / area];
      if (weights.some(v => v < -1e-8)) continue;
      const z = weights.reduce((v, w, k) => v + w * screen[ids[k] * 4 + 2], 0),
        pixel = y * width + x;
      if (z >= depth[pixel]) continue;
      depth[pixel] = z;
      const sum = weights.reduce((v, w, k) => v + w * screen[ids[k] * 4 + 3], 0);
      const perspective = weights.map((w, k) => w * screen[ids[k] * 4 + 3] / sum);
      let color = [180 * light, 185 * light, 188 * light];
      if (!plain) {
        const linear = [0, 1, 2].map(channel => perspective.reduce((v, w, k) => v + w * mesh.colors[ids[k] * 3 + channel] / 255, 0));
        if (tex && mesh.uvs) {
          const u = perspective.reduce((v, w, k) => v + w * mesh.uvs[ids[k] * 2], 0),
            v = perspective.reduce((s, w, k) => s + w * mesh.uvs[ids[k] * 2 + 1], 0);
          const tx = Math.max(0, Math.min(tex.width - 1, u * tex.width - 0.5)),
            ty = Math.max(0, Math.min(tex.height - 1, v * tex.height - 0.5));
          const ix = Math.floor(tx),
            iy = Math.floor(ty),
            fx = tx - ix,
            fy = ty - iy;
          for (let channel = 0; channel < 3; channel++) {
            const at = (dx, dy) => toLinear(tex.data[(Math.min(tex.height - 1, iy + dy) * tex.width + Math.min(tex.width - 1, ix + dx)) * 4 + channel] / 255);
            linear[channel] *= (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
          }
        }
        color = (mesh.observedSideOriented && facing < 0 ? [0.08, 0.11, 0.095] : linear).map(toSrgb);
      }
      for (let channel = 0; channel < 3; channel++) rgba[pixel * 4 + channel] = Math.max(0, Math.min(255, Math.round(color[channel])));
    }
  }
  writePng(file, width, height, rgba);
}
if (require.main === module) {
  const input = path.resolve(process.argv[2]),
    out = path.resolve(process.argv[3]);
  fs.mkdirSync(out, {
    recursive: true
  });
  const options = Object.fromEntries(process.argv.slice(4).map(arg => {
      const [key, ...parts] = arg.split('=');
      const value = parts.join('=');
      try {
        return [key, JSON.parse(value)];
      } catch {
        return [key, value];
      }
    })),
    started = Date.now();
  console.log('Reconstruction overrides:', JSON.stringify(options));
  let result, scan;
  if (input.endsWith('.bin')) result = v8.deserialize(fs.readFileSync(input));else {
    scan = parseScanFile(fs.readFileSync(input, 'utf8'));
    result = scan.rawCapture ? fuseRgbdKeyframes(scan.rawCapture.keyframes, scanFusionOptions(scan.rawCapture, 'surface', options)) : {
      mesh: scan.mesh,
      diagnostics: scan.captureQuality
    };
    fs.writeFileSync(path.join(out, 'result.bin'), v8.serialize(result));
    fs.writeFileSync(path.join(out, 'diagnostics.json'), JSON.stringify(result.diagnostics, null, 2));
  }
  if (!result.mesh) throw new Error(result.diagnostics?.reason || 'No mesh');
  const mesh = result.mesh,
    d = result.diagnostics;
  const center = new THREE.Vector3().addVectors(new THREE.Vector3(...Object.values(mesh.bounds.min)), new THREE.Vector3(...Object.values(mesh.bounds.max))).multiplyScalar(0.5);
  const shots = [['overview', [2.8, 2.7, 3.1], center.toArray()], ['curtains', [0.25, 1.65, -0.25], [-1.6, 1.55, -0.2]], ['painting', [-0.2, 1.85, 0.7], [-0.2, 1.85, -1.4]], ['shelf', [-0.2, 1.0, 0.7], [-0.2, 0.65, -1.4]], ['floor', [0.6, 2.7, 0.5], [-0.5, -0.14, -0.2]], ['side', [1.5, 1.7, -1.9], [-0.9, 1.2, -0.7]]];
  for (const [name, position, target] of shots) {
    const camera = new THREE.PerspectiveCamera(48, 4 / 3, 0.025, 100);
    camera.position.fromArray(position);
    camera.lookAt(...target);
    render(mesh, camera, path.join(out, name + '.png'));
    if (['painting', 'floor', 'side'].includes(name)) render(mesh, camera, path.join(out, name + '-geometry.png'), true);
  }
  console.log(JSON.stringify({
    elapsedSeconds: (Date.now() - started) / 1000,
    triangles: mesh.triangleCount,
    coverage: mesh.textureCoverage,
    bounds: mesh.bounds,
    pose: d?.alignment?.jointPoseRefinement,
    planar: d?.planarConsolidation,
    repair: d?.surfaceRepair
  }, null, 2));
}
module.exports = {
  render,
  writePng
};
