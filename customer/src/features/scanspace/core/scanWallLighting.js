import * as THREE from "three";
import { shadeUnobservedBacks } from "./renderMesh";
import { capturedLightReference as paintReference, linearScanBytes as linearBytes,
  relativeCapturedLight as relativeLight } from "./scanSurfaceLighting";

export function estimateWallLighting(wall) {
  const source = wall.texture;
  if (!source?.data || !source.width || !source.height) return null;
  const { width, height } = source, count = width * height;
  const valid = new Uint8Array(count), samples = [];
  const gridWidth = wall.extent ? wall.extent[1][0] - wall.extent[0][0] : 0;
  const gridHeight = wall.extent ? wall.extent[1][1] - wall.extent[0][1] : 0;
  const sampleStride = Math.max(1, Math.ceil(count / 8192));
  let paintPixels = 0;
  for (let pixel = 0; pixel < count; pixel++) {
    const x = pixel % width, y = Math.floor(pixel / width);
    const covered = !wall.footprint || !gridWidth || !gridHeight ||
      wall.footprint[Math.floor(y / height * gridHeight) * gridWidth + Math.floor(x / width * gridWidth)];
    if (!covered || wall.detailMask?.[pixel] >= 128 || !source.data[pixel * 4 + 3]) continue;
    valid[pixel] = 1;
    if (paintPixels++ % sampleStride === 0) samples.push([0, 1, 2].map(channel => linearBytes[source.data[pixel * 4 + channel]]));
  }
  const reference = paintReference(samples), data = new Uint8Array(count * 4);
  if (!reference) {
    for (let pixel = 0; pixel < count; pixel++) data.set([128, 128, 128, 255], pixel * 4);
    return { width, height, data, reference };
  }
  const queue = new Uint32Array(count); let head = 0, tail = 0;
  for (let pixel = 0; pixel < count; pixel++) {
    data[pixel * 4 + 3] = 255;
    if (!valid[pixel]) continue;
    const light = relativeLight([0, 1, 2].map(channel => linearBytes[source.data[pixel * 4 + channel]]), reference);
    for (let channel = 0; channel < 3; channel++) data[pixel * 4 + channel] = Math.min(255, Math.round(light[channel] * 127.5));
    queue[tail++] = pixel;
  }
  // Artwork and uncaptured pixels cannot supply wall-light measurements.
  // Extend nearby illumination beneath them; their original photo overlay
  // remains separate, so a dark picture never becomes a painted silhouette.
  while (head < tail) {
    const pixel = queue[head++], x = pixel % width;
    for (const next of [x ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1,
      pixel >= width ? pixel - width : -1, pixel + width < count ? pixel + width : -1]) {
      if (next < 0 || valid[next]) continue;
      valid[next] = 1;
      for (let channel = 0; channel < 3; channel++) data[next * 4 + channel] = data[pixel * 4 + channel];
      queue[tail++] = next;
    }
  }
  return { width, height, data, reference };
}

export function createWallLightingTexture(wall) {
  const image = estimateWallLighting(wall);
  if (!image) return null;
  const texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
  // This is linear illumination, with 0.5 encoding a factor of one. Using
  // sRGB here or applying the viewer's exposure again would wash out shadows.
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function capturedWallLightReference(mesh, surfaces) {
  const samples = [], wallFaces = [];
  for (let face = 0; face < (surfaces?.labels.length || 0); face++)
    if (surfaces.labels[face] === 1) wallFaces.push(face);
  const stride = Math.max(1, Math.ceil(wallFaces.length / 4096));
  for (let sample = 0; sample < wallFaces.length; sample += stride) {
    const face = wallFaces[sample], vertices = Array.from(mesh.indices.subarray(face * 3, face * 3 + 3));
    const color = [0, 1, 2].map(channel => vertices.reduce((sum, vertex) => sum + mesh.colors[vertex * 3 + channel] / 255, 0) / 3);
    if (mesh.texture && mesh.uvs) {
      const uv = [0, 1].map(axis => vertices.reduce((sum, vertex) => sum + mesh.uvs[vertex * 2 + axis], 0) / 3);
      const x = Math.min(mesh.texture.width - 1, Math.max(0, Math.floor(uv[0] * mesh.texture.width)));
      const y = Math.min(mesh.texture.height - 1, Math.max(0, Math.floor(uv[1] * mesh.texture.height)));
      const pixel = (y * mesh.texture.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) color[channel] *= linearBytes[mesh.texture.data[pixel + channel]];
    }
    samples.push(color);
  }
  return paintReference(samples) || [1, 1, 1];
}

export function wallPaintShader(reference = [.5, .5, .5], observedSide = false) {
  return shader => {
    shader.uniforms.scanPaintReference = { value: new THREE.Vector3(...reference) };
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>",
      "#include <common>\nuniform vec3 scanPaintReference;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
      vec3 scanLight = vec3(1.0);
      #ifdef USE_LIGHTMAP
        scanLight = texture2D(lightMap, vLightMapUv).rgb;
      #elif defined(USE_MAP)
        scanLight = sampledDiffuseColor.rgb;
      #endif
      #ifdef USE_COLOR
        scanLight *= vColor.rgb;
      #endif
      scanLight /= scanPaintReference;
      float scanBrightness = dot(scanLight, vec3(0.2126, 0.7152, 0.0722));
      scanLight = clamp(scanBrightness, 0.0, 2.0) * clamp(scanLight / max(scanBrightness, 0.00001), 0.88, 1.12);
      // Captured light replaces synthetic diffuse illumination. Only the
      // finish's restrained, view-dependent reflection uses the scene lights.
      float scanSheen = mix(0.03, 0.35, 1.0 - roughness);
      outgoingLight = diffuse * scanLight + min(totalSpecular, vec3(0.12)) * scanSheen * min(scanLight, vec3(1.0));
      #include <opaque_fragment>
    `);
    if (observedSide) shadeUnobservedBacks(shader);
  };
}

export const wallPaintProgramKey = () => "scan-captured-wall-lighting-v1";
export const sidedWallPaintProgramKey = () => "scan-captured-wall-lighting-sided-v1";
