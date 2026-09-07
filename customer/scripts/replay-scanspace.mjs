import { readFile } from "node:fs/promises";

// Load the same dependency-free core modules used by the browser worker.
const loadCore = async (name) => {
  const source = await readFile(new URL(`../src/features/scanspace/core/${name}.js`, import.meta.url), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
};

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
    diagnostics: result.diagnostics,
    mesh: result.mesh ? {
      kind: result.mesh.kind,
      triangles: result.mesh.triangleCount,
      bounds: result.mesh.bounds,
    } : null,
    note: "Depth replay excludes camera photos; texture coverage is not comparable.",
  }, null, 2) + "\n");
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
