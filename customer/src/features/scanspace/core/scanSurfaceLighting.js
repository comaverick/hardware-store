export const linearScanBytes = Float32Array.from({ length: 256 }, (_, byte) => {
  const value = byte / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
});
export const scanLuminance = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];

// Normalize against lit surface pixels, rather than the mean: a large shadow
// should stay dark. Base reflectance and illumination are estimates from RGB.
export function capturedLightReference(samples) {
  if (!samples.length) return null;
  const sorted = samples.map(scanLuminance).sort((a, b) => a - b);
  const lit = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .9))];
  if (lit < .004) return null;
  const lower = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .6))];
  const rgb = [0, 0, 0]; let weight = 0;
  for (const sample of samples) {
    const value = scanLuminance(sample);
    if (value < lower || value > lit || value < .004) continue;
    for (let channel = 0; channel < 3; channel++) rgb[channel] += sample[channel];
    weight += value;
  }
  return weight ? rgb.map(value => Math.max(.004, value / weight * lit)) : [lit, lit, lit];
}

export function relativeCapturedLight(rgb, reference) {
  const light = rgb.map((value, i) => value / reference[i]);
  const value = scanLuminance(light);
  return light.map(channel => Math.min(2, Math.max(0, value)) *
    Math.min(1.12, Math.max(.88, channel / Math.max(value, .00001))));
}
