import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/features/scanspace/core/planarSurface.js', import.meta.url), 'utf8');
const { consolidatePlanarSurfaces } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/check-scanspace-planes.mjs <saved-scan.json>');
const scan = JSON.parse(await readFile(path, 'utf8')).scan;
const decode = (entry) => new ({ f32: Float32Array, u32: Uint32Array, u8: Uint8Array }[entry.type])(Uint8Array.from(Buffer.from(entry.data, 'base64')).buffer);
const mesh = { positions: decode(scan.mesh.positions), indices: decode(scan.mesh.indices) };
const start = performance.now();
const result = consolidatePlanarSurfaces(mesh);
process.stdout.write(JSON.stringify({ source: path, seconds: (performance.now() - start) / 1000, diagnostics: result.planarConsolidation,
  note: 'Geometry-only check of the saved mesh, not raw depth replay or a new camera texture projection. The source file is unchanged.' }, null, 2) + '\n');
