import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router-dom";
import { CustomerAuthBoundary, useCustomerAuth } from "../../auth/CustomerAuthContext";
import { openAccountScan, pendingAccountScan } from "./accountScans";
import { detectCapabilities } from "./core/depth";
import { downloadDepthCapture } from "./core/captureDebug";
import {
  looksLikeScanFile,
  parseScanFile,
} from "./core/partialScanFile";
import { useScanSpace } from "./store";
import { useStoreAppearance } from "../../storefront/AppearancePicker";
import {
  api,
  captureStore,
  loadDraft,
  looksLikeScanDiagnostics,
  parseRoomImport,
} from "./services";
import RoomReview from "./components/RoomReview";
import SavedProjectsDialog from "./components/SavedProjectsDialog";
import ScanSpaceWelcome from "./components/ScanSpaceWelcome";
import ScanRenderProgress from "./components/ScanRenderProgress";
import "./scanspace.css";
import "../../storefront/theme.css";
import "./scanspace-home.css";
const ScannerPanel = lazy(() => import("./components/ScannerPanel"));
const RoomEditor = lazy(() => import("./components/RoomEditor"));
const PartialScanReview = lazy(
  () => import("./components/PartialScanReview"),
);
export default function ScanSpace() {
  return <CustomerAuthBoundary><ScanSpaceContent /></CustomerAuthBoundary>;
}
function ScanSpaceContent() {
  const { session, initializing, profileLoading } = useCustomerAuth();
  const location = useLocation(), navigate = useNavigate();
  const currentUid = session?.user?.uid || "";
  const uidRef = useRef(currentUid); uidRef.current = currentUid;
  const opening = useRef(null);
  const [source, setSource] = useState(null);
  const [stage, setStage] = useState("welcome"),
    [capabilities, setCapabilities] = useState(null),
    [reviewRoom, setReviewRoom] = useState(null),
    [surfaceScan, setSurfaceScan] = useState(null),
    [capture, setCapture] = useState({}),
    [error, setError] = useState(""),
    [importing, setImporting] = useState(null),
    [draft, setDraft] = useState(null),
    [savedOpen, setSavedOpen] = useState(false),
    [savedVersion, setSavedVersion] = useState(0);
  const transferStarted = useRef(false);
  const appearance = useStoreAppearance((state) => state.appearance);
  useEffect(() => {
    opening.current?.abort();
    if (source?.account && source.account.ownerUid !== currentUid) {
      setSource(null); setSurfaceScan(null); setStage("welcome");
      useScanSpace.setState({ room: null, original: null, textures: {}, scanCloud: null, scanMesh: null });
    }
  }, [currentUid, source?.account]);
  useEffect(() => () => opening.current?.abort(), []);
  const accountSaved = useCallback((account) => {
    setSource(value => value ? { ...value, account } : value);
    setSavedVersion(value => value + 1);
  }, []);
  const closeSavedProjects = useCallback(() => {
    setSavedOpen(false);
    setSavedVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    detectCapabilities().then((v) => {
      if (active) setCapabilities(v);
    });
    try {
      setDraft(loadDraft());
    } catch {}
    return () => {
      active = false;
    };
  }, []);
  const openRoom = useCallback((room, extra = {}) => {
    const { originalFile = null, originalRoom = room, account = null, ...roomExtras } = extra;
    setSource({ kind: "room", original: originalRoom, file: originalFile, account });
    useScanSpace.getState().setRoom(room, roomExtras);
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
  const openAccountProject = useCallback(async (project) => {
    const user = session?.user;
    if (!user) return;
    const controller = new AbortController(); opening.current?.abort(); opening.current = controller;
    const isCurrent = () => !controller.signal.aborted && uidRef.current === user.uid;
    setImporting({ name: project.name }); setStage("importing"); setError("");
    try {
      const { scan: account, file } = await openAccountScan(user, project.id, controller.signal);
      const contents = await file.text();
      if (!isCurrent()) return;
      const owned = { ...account, ownerUid: user.uid };
      if (account.kind === "room") {
        const originalRoom = parseRoomImport(contents);
        openRoom(account.room || originalRoom, { originalRoom, originalFile: file, account: owned });
      } else {
        const raw = parseScanFile(contents);
        setSource({ kind: "scan", original: raw, file, account: owned });
        setSurfaceScan({ ...raw, customization: account.customization });
        setStage("surface");
      }
    } catch (reason) {
      if (isCurrent()) { setStage("welcome"); setError(reason.message || "The saved scan could not open. Please retry."); }
    } finally {
      if (opening.current === controller) { opening.current = null; setImporting(null); if (controller.signal.aborted) setStage("welcome"); }
    }
  }, [session?.user, openRoom]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("resume") !== "account-save" || initializing || profileLoading || !session?.emailVerified) return;
    let active = true;
    pendingAccountScan("get").then(async saved => {
      if (!active || !saved) return;
      if (saved.ownerUid && saved.ownerUid !== currentUid) throw new Error("Sign in to the original account to resume this scan.");
      const contents = await saved.file.text();
      if (!active) return;
      if (saved.kind === "room") {
        const originalRoom = parseRoomImport(contents);
        openRoom(saved.metadata.room || originalRoom, { originalRoom, originalFile: saved.file });
      } else {
        const raw = parseScanFile(contents);
        setSource({ kind: "scan", original: raw, file: saved.file, account: null });
        setSurfaceScan({ ...raw, customization: saved.metadata.customization }); setStage("surface");
      }
      await pendingAccountScan("delete");
      params.delete("resume");
      if (active) navigate(`${location.pathname}${params.size ? `?${params}` : ""}`, { replace: true });
    }).catch(reason => { if (active) setError(reason.message || "The scan could not be resumed. Import your exported file."); });
    return () => { active = false; };
  }, [location.pathname, location.search, initializing, profileLoading, session?.emailVerified, currentUid, openRoom, navigate]);
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
      setError("");
      setImporting({ name: file.name });
      setStage("importing");
      const beginning = await file.slice(0, 65536).text();
      const scanFile = looksLikeScanFile(beginning);
      if (looksLikeScanDiagnostics(file.name, beginning))
        throw new Error(
          "This is a scan-diagnostics file, not a ScanSpace scan. Import a saved scan or room export instead.",
        );
      const contents = await file.text();
      if (scanFile) {
        const scan = parseScanFile(contents);
        setSource({ kind: "scan", original: scan, file, account: null });
        setSurfaceScan(scan);
        setStage("surface");
        setError("");
      } else {
        openRoom(parseRoomImport(contents), { originalFile: file });
      }
    } catch (reason) {
      setStage("welcome");
      setError(reason.message || "The ScanSpace file could not be opened.");
    } finally {
      setImporting(null);
      input.value = "";
    }
  }
  if (stage === "editor")
    return (
      <Suspense
        fallback={<div className="ss-loading">Opening the editor…</div>}
      >
        <RoomEditor
          source={source} onAccountSaved={accountSaved} onOpenLegacy={openSavedProject}
          onExit={() => {
            setStage("welcome");
            setSavedVersion(value => value + 1);
            try { setDraft(loadDraft()); } catch { setDraft(null); }
          }}
        />
      </Suspense>
    );
  return (
    <main className={`ss-app${stage === "welcome" ? " ss-app--home storefront-shell" : ""}`} data-theme={appearance}>
      {stage !== "welcome" && <header className="ss-header">
        <a href="/" className="ss-back">
          <ArrowLeft size={18} />
          <span>Back to store</span>
        </a>
        <a href="/scanspace" className="ss-brand">
          Scan<span>Space</span>
        </a>
        <span className="ss-header-label">Room planning</span>
      </header>}
      {stage === "welcome" && <ScanSpaceWelcome
        capabilities={capabilities} draft={draft} error={error} savedVersion={savedVersion}
        onScan={() => { setSource(null); setCapture({}); setStage("scan"); }}
        onMeasure={() => { setSource(null); setReviewRoom(null); setCapture({}); setStage("review"); }}
        onImport={importRoom} onContinue={continueDraft}
        onOpenProject={openAccountProject} onManage={() => setSavedOpen(true)}
      />}
      {stage === "importing" && (
        <div className="ss-import-rendering">
          <ScanRenderProgress
            title="Opening your scan"
            detail={
              importing?.name
                ? `Reading ${importing.name}. The raw capture will render next.`
                : "Reading the selected ScanSpace file."
            }
          />
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
              setSource({ kind: "scan", original: scan, file: null, account: null });
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
            source={source} onAccountSaved={accountSaved}
            onDone={() => {
              setSurfaceScan(null);
              setSavedVersion(value => value + 1);
              setStage("welcome");
            }}
            onRescan={() => {
              setSurfaceScan(null);
              setSource(null);
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
          onClose={closeSavedProjects}
          onLoad={openSavedProject}
        />
      )}
    </main>
  );
}
