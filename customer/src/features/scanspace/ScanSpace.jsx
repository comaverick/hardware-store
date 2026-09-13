import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Cube,
  FolderOpen,
  Ruler,
  UploadSimple,
} from "@phosphor-icons/react";
import { detectCapabilities } from "./core/depth";
import { downloadDepthCapture } from "./core/captureDebug";
import {
  looksLikeScanFile,
  MAX_SCAN_FILE_IMPORT_BYTES,
  parseScanFile,
} from "./core/partialScanFile";
import { useScanSpace, sampleRoom } from "./store";
import {
  api,
  captureStore,
  loadDraft,
  looksLikeScanDiagnostics,
  MAX_ROOM_IMPORT_BYTES,
  parseRoomImport,
} from "./services";
import RoomReview from "./components/RoomReview";
import SavedProjectsDialog from "./components/SavedProjectsDialog";
import "./scanspace.css";
const ScannerPanel = lazy(() => import("./components/ScannerPanel"));
const RoomEditor = lazy(() => import("./components/RoomEditor"));
const RoomScene = lazy(() => import("./components/RoomScene"));
const PartialScanReview = lazy(
  () => import("./components/PartialScanReview"),
);
export default function ScanSpace() {
  const [stage, setStage] = useState("welcome"),
    [capabilities, setCapabilities] = useState(null),
    [reviewRoom, setReviewRoom] = useState(null),
    [surfaceScan, setSurfaceScan] = useState(null),
    [capture, setCapture] = useState({}),
    [error, setError] = useState(""),
    [draft, setDraft] = useState(false),
    [savedOpen, setSavedOpen] = useState(false);
  const transferStarted = useRef(false);
  const demo = useMemo(() => sampleRoom(), []);
  useEffect(() => {
    let active = true;
    detectCapabilities().then((v) => {
      if (active) setCapabilities(v);
    });
    try {
      setDraft(!!loadDraft());
    } catch {}
    return () => {
      active = false;
    };
  }, []);
  const openRoom = useCallback((room, extra = {}) => {
    useScanSpace.getState().setRoom(room, extra);
    setStage("editor");
    setError("");
  }, []);
  const openSavedProject = useCallback(async (project) => {
    let saved;
    try {
      saved = await captureStore("get");
    } catch {}
    const textures =
      saved?.outline === JSON.stringify(project.room.floorPolygon)
        ? saved.textures
        : {};
    openRoom(project.room, {
      projectId: project._id,
      revision: project.revision,
      textures,
    });
    setSavedOpen(false);
  }, [openRoom]);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("transfer");
    if (!code || transferStarted.current) return;
    transferStarted.current = true;
    api("/transfers/claim", { code })
      .then((project) => openSavedProject(project))
      .catch((reason) =>
        setError(`This transfer link could not be opened. ${reason.message}`),
      )
      .finally(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete("transfer");
        window.history.replaceState({}, "", url);
      });
  }, [openSavedProject]);
  async function continueDraft() {
    try {
      const room = loadDraft();
      if (!room) return;
      let saved;
      try {
        saved = await captureStore("get");
      } catch {}
      const textures =
        saved?.outline === JSON.stringify(room.floorPolygon)
          ? saved.textures
          : {};
      openRoom(room, { textures });
    } catch (e) {
      setError(e.message);
    }
  }
  async function importRoom(e) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const beginning = await file.slice(0, 65536).text();
      const scanFile = looksLikeScanFile(beginning);
      if (looksLikeScanDiagnostics(file.name, beginning))
        throw new Error(
          "This is a scan-diagnostics file, not a ScanSpace scan. Import a saved scan or room export instead.",
        );
      const limit = scanFile
        ? MAX_SCAN_FILE_IMPORT_BYTES
        : MAX_ROOM_IMPORT_BYTES;
      if (file.size > limit)
        throw new Error(
          scanFile
            ? "Scan files can be up to 64 MB."
            : "Saved room files can be up to 10 MB.",
        );
      const contents = await file.text();
      if (scanFile) {
        setSurfaceScan(parseScanFile(contents));
        setStage("surface");
        setError("");
      } else {
        openRoom(parseRoomImport(contents));
      }
    } catch (reason) {
      setError(reason.message || "The ScanSpace file could not be opened.");
    } finally {
      input.value = "";
    }
  }
  if (stage === "editor")
    return (
      <Suspense
        fallback={<div className="ss-loading">Opening the editor…</div>}
      >
        <RoomEditor
          onExit={() => {
            setStage("welcome");
            setDraft(true);
          }}
        />
      </Suspense>
    );
  return (
    <main className="ss-app">
      <header className="ss-header">
        <a href="/" className="ss-back">
          <ArrowLeft size={18} />
          <span>Back to store</span>
        </a>
        <a href="/scanspace" className="ss-brand">
          Scan<span>Space</span>
        </a>
        <span className="ss-header-label">Room planning</span>
      </header>
      {stage === "welcome" && (
        <div className="ss-welcome">
          <div className="ss-intro">
            <span className="ss-kicker">See the possibilities.</span>
            <h1>
              Your room.
              <br />A fresh perspective.
            </h1>
            <p>
              Capture your space, try new finishes, and find the materials to
              make it happen.
            </p>
            <div className="ss-start-actions">
              <button
                className="ss-primary"
                onClick={() => {
                  setCapture({});
                  setStage("scan");
                }}
                disabled={!capabilities?.ar}
              >
                <Camera size={21} />
                Scan a space
                <ArrowRight size={18} />
              </button>
              <button
                onClick={() => {
                  setReviewRoom(null);
                  setCapture({});
                  setStage("review");
                }}
              >
                <Ruler size={20} />
                Enter measurements
              </button>
              <button onClick={() => setSavedOpen(true)}>
                <FolderOpen size={20} />
                Open saved room
              </button>
            </div>
            <p className="ss-device-note">
              {!capabilities
                ? "Checking this device…"
                : capabilities.ar
                  ? "Android camera scanning is available. Depth support is checked when the scan starts."
                  : capabilities.error ||
                    "Open on a compatible Android phone to scan. You can design with measurements on this device."}
            </p>
            <div className="ss-welcome-links">
              <button onClick={() => openRoom(sampleRoom())}>
                <Cube size={18} />
                Explore a sample room
              </button>
              {draft && (
                <button onClick={continueDraft}>
                  Continue my saved room
                  <ArrowRight size={16} />
                </button>
              )}
              <label className="ss-import">
                <UploadSimple size={17} />
                Import scan
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={importRoom}
                />
              </label>
            </div>
            {error && (
              <p role="alert" className="ss-error">
                {error}
              </p>
            )}
          </div>
          <div className="ss-welcome-room">
            <div className="ss-preview-label">
              <strong>Studio living room</strong>
              <span>Interactive sample · 4.8 × 4 m</span>
            </div>
            <Suspense
              fallback={
                <div className="ss-loading">Preparing room preview…</div>
              }
            >
              <RoomScene
                room={demo}
                mode="orbit"
                onSelect={() => {}}
                onMove={() => {}}
              />
            </Suspense>
            <button
              className="ss-preview-cta"
              onClick={() => openRoom(sampleRoom())}
            >
              Step inside this room
              <ArrowRight size={18} />
            </button>
          </div>
          <ol className="ss-workflow">
            <li>
              <span>01</span>
              <div>
                <strong>Capture your space</strong>
                <p>
                  Scan with depth where supported, or enter your measurements.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Make it your own</strong>
                <p>
                  Try wall colors, floor finishes, and furniture at real scale.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Plan your materials</strong>
                <p>Calculate quantities using your room and store products.</p>
              </div>
            </li>
          </ol>
        </div>
      )}
      {stage === "scan" && (
        <Suspense
          fallback={<div className="ss-loading">Preparing scanner…</div>}
        >
          <ScannerPanel
            capabilities={capabilities || {}}
            onCancel={() => setStage("welcome")}
            onComplete={(room, data) => {
              setReviewRoom(room);
              setCapture(data);
              setStage("review");
            }}
            onSurface={(scan) => {
              setSurfaceScan(scan);
              setStage("surface");
            }}
          />
        </Suspense>
      )}
      {stage === "surface" && surfaceScan && (
        <Suspense
          fallback={<div className="ss-loading">Opening scan result…</div>}
        >
          <PartialScanReview
            scan={surfaceScan}
            onCompleteManually={() => {
              setReviewRoom(null);
              setCapture({
                scanMesh: surfaceScan.mesh || null,
                scanCloud: surfaceScan.cloud || null,
                textures: {},
              });
              setSurfaceScan(null);
              setStage("review");
            }}
            onDone={() => {
              setSurfaceScan(null);
              setStage("welcome");
            }}
            onRescan={() => {
              setSurfaceScan(null);
              setStage("scan");
            }}
          />
        </Suspense>
      )}
      {stage === "review" && (
        <>
          <RoomReview
            initial={reviewRoom}
            onCancel={() => setStage("welcome")}
            onComplete={(room) =>
              openRoom(room, {
                textures: capture.textures || {},
                scanCloud: capture.scanCloud || null,
                scanMesh: capture.scanMesh || null,
                before: !!(capture.scanMesh || capture.scanCloud),
              })
            }
          />
          {capture.stats && (
            <div className="ss-scan-summary">
              <strong>Scan review</strong>
              {capture.debugCapture && (
                <button type="button" onClick={() =>
                  downloadDepthCapture(capture.debugCapture, capture.stats.fusion)}>
                  Download scan diagnostics
                </button>
              )}
              <p>
                {capture.stats.depthFrames} depth frames ·{" "}
                {capture.stats.pointCount.toLocaleString()} points ·{" "}
                {capture.partial
                  ? `Captured sweep · ${capture.stats.coverage || 0}% view coverage · `
                  : "Measured outline · "}
                {capture.ceilingMeasured
                  ? "Ceiling observed"
                  : "Ceiling height estimated"}
              </p>
              {capture.partial && (
                <p>
                  ScanSpace inferred {capture.inferredWallCount || "some"}{" "}
                  room boundaries from the captured surfaces. Recheck the room
                  outline before relying on material estimates.
                </p>
              )}
              <p>
                {Object.keys(capture.textures || {}).length
                  ? "Captured wall colors available in the editor."
                  : "Captured color unavailable. Your room will use editable preview finishes."}
              </p>
              <button
                onClick={() => {
                  setCapture({});
                  setStage("scan");
                }}
              >
                Scan again
              </button>
            </div>
          )}
        </>
      )}
      {savedOpen && (
        <SavedProjectsDialog
          onClose={() => setSavedOpen(false)}
          onLoad={openSavedProject}
        />
      )}
    </main>
  );
}
