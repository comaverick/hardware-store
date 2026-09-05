import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Cube,
  Ruler,
  UploadSimple,
} from "@phosphor-icons/react";
import { detectCapabilities } from "./core/depth";
import { useScanSpace, sampleRoom } from "./store";
import { loadDraft, captureStore } from "./services";
import RoomReview from "./components/RoomReview";
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
    [partialScan, setPartialScan] = useState(null),
    [capture, setCapture] = useState({}),
    [error, setError] = useState(""),
    [draft, setDraft] = useState(false);
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
  function openRoom(room, extra = {}) {
    useScanSpace.getState().setRoom(room, extra);
    setStage("editor");
    setError("");
  }
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
  function importRoom(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512000) {
      setError("Room JSON must be under 500 KB.");
      return;
    }
    file
      .text()
      .then((value) => {
        openRoom(JSON.parse(value));
      })
      .catch((err) => setError(err.message));
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
                Scan my room
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
                Import room JSON
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
            onPartial={(scan, data) => {
              setPartialScan(scan);
              setCapture(data);
              setStage("partial");
            }}
          />
        </Suspense>
      )}
      {stage === "partial" && partialScan && (
        <Suspense
          fallback={<div className="ss-loading">Opening partial scan…</div>}
        >
          <PartialScanReview
            scan={partialScan}
            onDone={() => {
              setPartialScan(null);
              setCapture({});
              setStage("welcome");
            }}
            onRescan={() => {
              setPartialScan(null);
              setCapture({});
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
              openRoom(room, { textures: capture.textures || {} })
            }
          />
          {capture.stats && (
            <div className="ss-scan-summary">
              <strong>Scan review</strong>
              <p>
                {capture.stats.depthFrames} depth frames ·{" "}
                {capture.stats.pointCount.toLocaleString()} points ·{" "}
                {capture.partial
                  ? `Partial scan · ${capture.stats.coverage || 0}% view sweep · `
                  : "Depth outline complete · "}
                {capture.ceilingMeasured
                  ? "Ceiling observed"
                  : "Ceiling height estimated"}
              </p>
              {capture.partial && (
                <p>
                  ScanSpace inferred {capture.inferredWallCount || "some"}{" "}
                  unscanned wall boundaries from the measured surfaces. Recheck
                  the room outline before relying on material estimates.
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
                Rescan room
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
