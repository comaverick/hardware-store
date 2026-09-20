// Local, static snapshots of the actual ScannerPanel and CSS for mobile-layout
// checks without WebXR hardware. Sensor values are explicitly simulated; these
// pages do not acquire depth or test rendering quality. Nothing is written out.
// Usage: node scripts/preview-capture-feedback.cjs [port]
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const Module = require("node:module");
const babel = require("@babel/core");
const { JSDOM } = require("jsdom");
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://127.0.0.1/" });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const rootDirectory = path.resolve(__dirname, "..");
const cache = new Map();
let activeStats;

function load(file) {
  file = path.resolve(file);
  if (file.endsWith(`${path.sep}RoomScanner.js`)) return { RoomScanner: class {
    constructor({ onUpdate }) { this.update = onUpdate; this.paused = false; }
    async start() { this.publish(); }
    async stop() {}
    publish() { this.update({ ...activeStats, paused: this.paused }); }
    result() { return { stats: activeStats, points: [], keyframes: [{ timestamp: 1 }, { timestamp: 2 }],
      textureKeyframes: [], floorY: 0, observer: { x: 0, z: 0 } }; }
  } };
  if (file.endsWith(`${path.sep}captureDebug.js`)) return {
    snapshotDepthCapture: () => new Blob(), downloadDepthCapture() {},
  };
  if (file.endsWith(`${path.sep}createFusionWorker.js`)) return { createFusionWorker() {
    const worker = { terminate() {}, postMessage() {
      Promise.resolve().then(() => worker.onmessage({ data: { type: "complete", result: {
        mesh: { triangleCount: 100 }, diagnostics: {},
      } } }));
    } };
    return worker;
  } };
  if (file.endsWith(`${path.sep}PartialScanScene.jsx`)) return { __esModule: true, default: () =>
    React.createElement("div", { className: "ss-partial-scene", style: { display: "grid", placeItems: "center" } },
      React.createElement("p", null, "Simulated preview · layout only"),
      React.createElement("div", { className: "ss-partial-viewbar" }, React.createElement("button", null, "Reset")),
      React.createElement("span", { className: "ss-view-hint" }, "Drag to orbit · Pinch to zoom")),
  };
  if (cache.has(file)) return cache.get(file).exports;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  cache.set(file, loaded);
  loaded.require = id => {
    if (!id.startsWith(".")) return require(id);
    const base = path.resolve(path.dirname(file), id);
    return load(require.resolve(fs.existsSync(`${base}.jsx`) ? `${base}.jsx` : base));
  };
  loaded._compile(babel.transformSync(fs.readFileSync(file, "utf8"), {
    presets: [["@babel/preset-react", { runtime: "automatic" }]],
    plugins: ["@babel/plugin-transform-dynamic-import", "@babel/plugin-transform-modules-commonjs"], babelrc: false, configFile: false,
  }).code, file);
  return loaded.exports;
}

async function fixture(name) {
  const recovering = name === "recovering", checking = name === "checking", moving = name === "motion";
  activeStats = {
    tracking: true, depthActive: true, depthCurrent: true, depthState: "active", floorY: 0,
    floorAutoDetected: true, fusionKeyframes: 12, cameraBaseline: 0.5, stablePointCount: 1600,
    currentViewChecked: !(recovering || checking || moving),
    currentConfirmedRatio: recovering || checking || moving ? 0 : 0.72, connectedSurfaceCoverage: 65,
    movingTooFast: moving, frameQuality: moving ? "moving-too-fast" : recovering ? "overlap-lost" : "connected",
    features: [], errors: [], colorActive: true, captureProfile: "careful",
    recoveryDirection: "Turn gently left toward your last scanned area.",
    adaptiveCapture: { connected: true, state: recovering ? "recovering" : checking ? "checking" : "tracking", pendingCount: recovering ? 4 : 0,
      coverage: { regions: [
        { id: "lower", observed: 100, confirmed: 70, ratio: 0.7 },
        { id: "middle", observed: 160, confirmed: 140, ratio: 0.875 },
        { id: "upper", observed: 80, confirmed: 16, ratio: 0.2 },
      ] } },
  };
  const root = createRoot(document.getElementById("root"));
  const Panel = load(path.join(rootDirectory, "src/features/scanspace/components/ScannerPanel.jsx")).default;
  await React.act(() => root.render(React.createElement(Panel, {
    capabilities: { ar: true, secure: true, browser: "Simulated layout fixture" }, onCancel() {}, onSurface() {},
  })));
  const click = label => React.act(async () => {
    const button = [...document.querySelectorAll("button")].find(element => element.textContent === label);
    if (!button) throw new Error(`Missing fixture action: ${label}`);
    button.click();
  });
  await click("Start camera scan");
  if (name === "review") await click("Review scan");
  const markup = document.getElementById("root").innerHTML;
  await React.act(() => root.unmount());
  return markup;
}

(async () => {
  const pages = new Map();
  for (const name of ["tracking", "checking", "motion", "recovering", "review"]) pages.set(`/${name}`, await fixture(name));
  const cssPath = path.join(rootDirectory, "src/features/scanspace/scanspace.css");
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/layout") {
      const state = pages.has(`/${url.searchParams.get("state")}`) ? url.searchParams.get("state") : "tracking";
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(`<!doctype html><html><head><title>Simulated mobile capture layouts</title></head><body style="margin:16px;font-family:Arial,sans-serif"><h1>Simulated ${state} controls</h1><p>UI layout check only. No camera, depth, or actual reconstruction.</p><nav>${[...pages.keys()].map(route => `<a style="margin-right:16px" href="/layout?state=${route.slice(1)}">${route.slice(1)}</a>`).join("")}</nav><main style="display:flex;gap:16px;flex-wrap:wrap">${[[360, 640], [320, 568], [640, 360]].map(([width, height]) => `<section><h2>${width} × ${height}</h2><iframe title="${width} × ${height}" src="/${state}" width="${width}" height="${height}" style="border:0"></iframe></section>`).join("")}</main></body></html>`);
      return;
    }
    const markup = pages.get(url.pathname);
    response.writeHead(markup ? 200 : 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(markup ? `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated capture layout</title><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}${fs.readFileSync(cssPath, "utf8")}.ss-app{background:#35453e}</style></head><body><main class="ss-app">${markup}</main></body></html>` : "Use /layout, /tracking, /checking, /motion, /recovering, or /review. Sensor data is simulated.");
  });
  const port = Number(process.argv[2]) || 3977;
  server.listen(port, "127.0.0.1", () => console.log(`Static capture UI fixtures: http://127.0.0.1:${port}/tracking (PID ${process.pid})`));
  server.on("error", error => { console.error(error); process.exitCode = 1; });
})().catch(error => { console.error(error); process.exitCode = 1; });
