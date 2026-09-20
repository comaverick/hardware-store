import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Load the same core modules used by the browser worker, without changing the
// application's CommonJS package configuration for this Node-only CLI.
// Use the recursive production-module loader: fusion now has multiple local
// dependencies, which cannot resolve relative to a data: module URL.
const { load } = createRequire(import.meta.url)("./replay-scanspace.cjs");
const loadCore = async name => load(`src/features/scanspace/core/${name}.js`);

try {
  const capturePath = process.argv[2];
  if (!capturePath) throw new Error("Usage: node scripts/replay-scanspace.mjs <capture.json>");
  const [{ fuseRgbdKeyframes }, { restoreDepthCapture }] = await Promise.all([
    loadCore("fusion"), loadCore("captureDebug"),
  ]);
  let serialized;
  if (capturePath === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    serialized = Buffer.concat(chunks).toString("utf8");
  } else serialized = await readFile(capturePath, "utf8");
  const input = restoreDepthCapture(JSON.parse(serialized));
  const result = fuseRgbdKeyframes(input.keyframes, input.options);
  process.stdout.write(JSON.stringify({
    capture: input.metadata,
    diagnostics: result.diagnostics,
    mesh: result.mesh ? {
      kind: result.mesh.kind,
      triangles: result.mesh.triangleCount,
      bounds: result.mesh.bounds,
    } : null,
    note: input.metadata.ambiguousLegacyGeometry
      ? "This legacy capture contains ambiguous transformed depth UVs. Record a fresh version 4 capture for repaired-coordinate replay."
      : "Depth replay excludes camera photos; texture coverage is not comparable.",
  }, null, 2) + "\n");
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
