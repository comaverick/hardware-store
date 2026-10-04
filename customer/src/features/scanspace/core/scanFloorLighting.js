import * as THREE from "three";
import { shadeUnobservedBacks } from "./renderMesh";
import { capturedLightReference, linearScanBytes, relativeCapturedLight } from "./scanSurfaceLighting";

const dot = (axis, positions, vertex) => axis[0] * positions[vertex * 3] +
  axis[1] * positions[vertex * 3 + 1] + axis[2] * positions[vertex * 3 + 2];

function capturedColor(mesh, vertices, barycentric) {
  const color = [0, 1, 2].map(channel => vertices.reduce((sum, vertex, i) =>
    sum + barycentric[i] * (mesh.colors?.[vertex * 3 + channel] ?? 255) / 255, 0));
  const image = mesh.texture;
  if (!image?.data || !mesh.uvs) return color; // portable colors are already linear
  const uv = [0, 1].map(axis => vertices.reduce((sum, vertex, i) => sum + mesh.uvs[vertex * 2 + axis] * barycentric[i], 0));
  const x = Math.max(0, Math.min(image.width - 1, uv[0] * image.width - .5));
  const y = Math.max(0, Math.min(image.height - 1, uv[1] * image.height - .5));
  const left = Math.floor(x), bottom = Math.floor(y), fx = x - left, fy = y - bottom;
  const rgb = [0, 0, 0];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const pixel = (Math.min(image.height - 1, bottom + dy) * image.width + Math.min(image.width - 1, left + dx)) * 4;
    const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
    for (let channel = 0; channel < 3; channel++) rgb[channel] += linearScanBytes[image.data[pixel + channel]] * weight;
  }
  return rgb.map((value, channel) => value * color[channel]);
}

function blurLighting(rgb, observed, width, height, cellSize) {
  // Suppress the old wood grain and narrow grout lines in physical metres.
  // The wider light falloff and furniture shadows belong to the new finish.
  const sigma = .1 / cellSize, radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-.5 * ((i - radius) / sigma) ** 2));
  let input = rgb, weights = observed;
  for (const axis of [0, 1]) {
    const output = new Float32Array(rgb.length), outputWeights = new Float32Array(observed.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      for (let offset = -radius; offset <= radius; offset++) {
        const sx = x + (axis === 0 ? offset : 0), sy = y + (axis === 1 ? offset : 0);
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
        const source = sy * width + sx, weight = kernel[offset + radius];
        outputWeights[pixel] += weights[source] * weight;
        for (let channel = 0; channel < 3; channel++) output[pixel * 3 + channel] += input[source * 3 + channel] * weight;
      }
    }
    input = output; weights = outputWeights;
  }
  for (let pixel = 0; pixel < observed.length; pixel++) if (weights[pixel])
    for (let channel = 0; channel < 3; channel++) input[pixel * 3 + channel] /= weights[pixel];
  return { rgb: input, weights };
}

export function estimateFloorLighting(mesh, surfaces) {
  const axes = surfaces?.floorAxes;
  if (!axes || !mesh?.indices?.length) return null;
  const faces = [], min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (let face = 0; face < surfaces.labels.length; face++) if (surfaces.labels[face] === 2) {
    faces.push(face);
    for (let corner = 0; corner < 3; corner++) for (let axis = 0; axis < 2; axis++) {
      const value = dot(axes[axis], mesh.positions, mesh.indices[face * 3 + corner]);
      min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
    }
  }
  if (!faces.length || !min.every(Number.isFinite) || !max.every(Number.isFinite)) return null;
  const cellSize = Math.max(.04, (max[0] - min[0]) / 508, (max[1] - min[1]) / 508);
  const origin = min.map(value => value - cellSize * 2);
  const width = Math.max(5, Math.ceil((max[0] - min[0]) / cellSize) + 4);
  const height = Math.max(5, Math.ceil((max[1] - min[1]) / cellSize) + 4), count = width * height;
  const rgb = new Float32Array(count * 3), weights = new Float32Array(count);
  function add(x, y, color, weight) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixel = y * width + x;
    weights[pixel] += weight;
    for (let channel = 0; channel < 3; channel++) rgb[pixel * 3 + channel] += color[channel] * weight;
  }
  for (const face of faces) {
    const vertices = Array.from(mesh.indices.subarray(face * 3, face * 3 + 3));
    const points = vertices.map(vertex => axes.map((axis, i) => (dot(axis, mesh.positions, vertex) - origin[i]) / cellSize));
    const [a, b, c] = points;
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-8) continue;
    const area = Math.abs(denominator) / 2; let rasterized = false;
    if (area > 2) {
      const lo = [0, 1].map(axis => Math.max(0, Math.floor(Math.min(...points.map(p => p[axis])))));
      const hi = [0, 1].map(axis => Math.min((axis ? height : width) - 1, Math.ceil(Math.max(...points.map(p => p[axis])))));
      for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
        const u = ((b[1] - c[1]) * (x + .5 - c[0]) + (c[0] - b[0]) * (y + .5 - c[1])) / denominator;
        const v = ((c[1] - a[1]) * (x + .5 - c[0]) + (a[0] - c[0]) * (y + .5 - c[1])) / denominator;
        if (Math.min(u, v, 1 - u - v) < -1e-6) continue;
        add(x, y, capturedColor(mesh, vertices, [u, v, 1 - u - v]), 1);
        rasterized = true;
      }
    }
    if (!rasterized) {
      const center = [0, 1].map(axis => points.reduce((sum, p) => sum + p[axis], 0) / 3 - .5);
      const left = Math.floor(center[0]), bottom = Math.floor(center[1]);
      const fx = center[0] - left, fy = center[1] - bottom, color = capturedColor(mesh, vertices, [1 / 3, 1 / 3, 1 / 3]);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
        add(left + dx, bottom + dy, color, area * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy));
    }
  }
  const observed = Float32Array.from(weights, weight => weight > 0 ? 1 : 0);
  for (let pixel = 0; pixel < count; pixel++) if (weights[pixel])
    for (let channel = 0; channel < 3; channel++) rgb[pixel * 3 + channel] /= weights[pixel];
  const smooth = blurLighting(rgb, observed, width, height, cellSize), samples = [];
  const stride = Math.max(1, Math.ceil(count / 8192));
  for (let pixel = 0; pixel < count; pixel += stride) if (observed[pixel])
    samples.push(Array.from(smooth.rgb.subarray(pixel * 3, pixel * 3 + 3)));
  const reference = capturedLightReference(samples), data = new Uint8Array(count * 4);
  const valid = new Uint8Array(count), queue = new Uint32Array(count); let head = 0, tail = 0;
  for (let pixel = 0; pixel < count; pixel++) {
    data.set([128, 128, 128, 255], pixel * 4);
    if (!reference || !smooth.weights[pixel]) continue;
    const light = relativeCapturedLight(Array.from(smooth.rgb.subarray(pixel * 3, pixel * 3 + 3)), reference);
    for (let channel = 0; channel < 3; channel++) data[pixel * 4 + channel] = Math.min(255, Math.round(light[channel] * 127.5));
    valid[pixel] = 1; queue[tail++] = pixel;
  }
  // Extend illumination into texture padding, without adding any floor faces.
  while (head < tail) {
    const pixel = queue[head++], x = pixel % width;
    for (const next of [x ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1,
      pixel >= width ? pixel - width : -1, pixel + width < count ? pixel + width : -1]) {
      if (next < 0 || valid[next]) continue;
      valid[next] = 1; queue[tail++] = next;
      for (let channel = 0; channel < 3; channel++) data[next * 4 + channel] = data[pixel * 4 + channel];
    }
  }
  return { width, height, data, origin, size: [width * cellSize, height * cellSize], cellSize, reference };
}

export function createFloorLighting(mesh, surfaces) {
  const image = estimateFloorLighting(mesh, surfaces);
  if (!image) return null;
  const texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.channel = 2; texture.flipY = false;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { ...image, texture };
}

export function floorFinishShader(observedSide = false, minimumRoughness = .38) {
  return shader => {
    shader.uniforms.scanFloorMinimumRoughness = { value: minimumRoughness };
    shader.fragmentShader = `uniform float scanFloorMinimumRoughness;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `
      #include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor, scanFloorMinimumRoughness, 0.95);
    `).replace("#include <opaque_fragment>", `
      vec3 scanFloorLight = vec3(1.0);
      #ifdef USE_LIGHTMAP
        scanFloorLight = texture2D(lightMap, vLightMapUv).rgb * 2.0;
      #endif
      // The new pattern is albedo; the captured light stays in room coordinates.
      // Relight only the normal-map detail, keeping the room's broad shadows.
      float scanFloorRelief = 1.0;
      #if NUM_DIR_LIGHTS > 0
        scanFloorRelief += 0.35 * (dot(normal, directionalLights[0].direction) - dot(nonPerturbedNormal, directionalLights[0].direction));
      #endif
      outgoingLight = diffuseColor.rgb * scanFloorLight * clamp(scanFloorRelief, 0.90, 1.08)
        + min(totalSpecular, vec3(0.18)) * 0.3 * min(scanFloorLight, vec3(1.0));
      #include <opaque_fragment>
    `);
    if (observedSide) shadeUnobservedBacks(shader);
  };
}

export const floorFinishProgramKey = () => "scan-captured-floor-material-v2";
export const sidedFloorFinishProgramKey = () => "scan-captured-floor-material-sided-v2";
