import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Camera, Cube, DotsThree, FolderOpen, Plus, Ruler, Trash, UploadSimple, UserCircle, X } from "@phosphor-icons/react";
import { CustomerAuthBoundary, useCustomerAuth } from "../../../auth/CustomerAuthContext";
import AppearancePicker from "../../../storefront/AppearancePicker";
import { deleteAccountScan, listAccountScans, scanFileSize } from "../accountScans";

const savedDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "Saved room";
};

function Welcome({ capabilities, draft, onScan, onMeasure, onImport, onContinue, onOpenProject, onManage, error, savedVersion }) {
  const { session, customer, initializing, profileLoading } = useCustomerAuth();
  const [projects, setProjects] = useState(null);
  const [listError, setListError] = useState("");
  const [openingProject, setOpeningProject] = useState("");
  const [startOpen, setStartOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [projectOwner, setProjectOwner] = useState("");
  const [deleteChoice, setDeleteChoice] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const deleteDialog = useRef(null), deleteRequest = useRef(null);
  const startDialog = useRef(null);
  const fileInput = useRef(null);
  const pendingProject = useRef(false);
  const mounted = useRef(false);
  const name = customer?.name || session?.name || "";
  const user = session?.user;
  const uid = user?.uid || "";
  const currentUid = useRef(uid); currentUid.current = uid;
  const accountReady = Boolean(session?.emailVerified && !initializing && !profileLoading);
  const visibleProjects = projectOwner === uid && accountReady ? projects : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; deleteRequest.current?.abort(); };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setProjects(null);
    setProjectOwner(uid);
    setListError("");
    if (!accountReady) return () => controller.abort();
    listAccountScans(user, controller.signal).then((items) => {
      if (active) setProjects(items);
    }).catch(() => {
      if (active) { setProjects([]); setListError("Your saved scans could not load. Try again."); }
    });
    return () => { active = false; controller.abort(); };
  }, [retry, savedVersion, uid, user, accountReady]);
  useEffect(() => { deleteRequest.current?.abort(); setDeleteChoice(null); setDeleting(false); setOpeningProject(""); }, [uid]);
  useEffect(() => {
    if (!deleteChoice) { deleteDialog.current?.close?.(); return; }
    deleteDialog.current?.showModal?.();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [deleteChoice]);

  useEffect(() => {
    if (!startOpen) { startDialog.current?.close?.(); return; }
    startDialog.current?.showModal?.();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [startOpen]);

  const openProject = useCallback(async (project) => {
    if (pendingProject.current) return;
    pendingProject.current = true;
    setOpeningProject(project.id);
    setListError("");
    try {
      if (mounted.current) await onOpenProject(project);
    } catch {
      if (mounted.current) setListError("This scan could not open. Try again.");
    } finally {
      pendingProject.current = false;
      if (mounted.current) setOpeningProject("");
    }
  }, [onOpenProject]);

  async function removeProject() {
    if (deleting || !deleteChoice) return;
    const accountAtStart = uid;
    const controller = new AbortController(); deleteRequest.current = controller;
    setDeleting(true); setListError("");
    try {
      await deleteAccountScan(user, deleteChoice.id, controller.signal);
      if (mounted.current && currentUid.current === accountAtStart && !controller.signal.aborted) {
        setProjects(items => items.filter(item => item.id !== deleteChoice.id));
        setDeleteChoice(null);
      }
    } catch (reason) {
      if (mounted.current && !controller.signal.aborted) setListError(reason.message || "The scan could not be deleted. Try again.");
    } finally { if (mounted.current && currentUid.current === accountAtStart) setDeleting(false); }
  }

  function choose(action) { setStartOpen(false); action(); }

  return <>
    <a href="#ss-spaces" className="ss-home-skip">Skip to your spaces</a>
    <header className="ss-home-header">
      <div className="ss-home-header__left"><Link to="/products" className="ss-home-back" aria-label="Back to store"><ArrowLeft size={21} aria-hidden="true" /></Link>
        <Link to="/scanspace" className="ss-brand">Scan<span>Space</span></Link></div>
      <div className="ss-home-header__right"><AppearancePicker />
        <Link className="ss-home-account" to={session ? "/account" : "/login"} state={{ from: "/scanspace" }} aria-label={session ? "Your account" : "Sign in"}>
          <UserCircle size={23} aria-hidden="true" /><span>{initializing ? "Account" : session ? name.split(" ")[0] || "Account" : "Sign in"}</span>
        </Link></div>
    </header>
    <div className="ss-home-content" id="ss-spaces" tabIndex={-1}>
      <div className="ss-home-heading"><div><h1>Your spaces</h1><p>Scan a room, try finishes, and plan your materials.</p></div>
        <button type="button" className="ss-home-new" onClick={() => setStartOpen(true)}><Plus size={20} aria-hidden="true" />New scan</button></div>
      {error && <p className="ss-home-error" role="alert">{error}</p>}
      {draft && <button type="button" className="ss-home-draft" onClick={onContinue}>
        <span className="ss-home-room-icon"><Cube size={25} aria-hidden="true" /></span>
        <span><strong>Continue last session</strong><small>{draft.name || "Your room"} · On this device</small></span><ArrowRight size={20} aria-hidden="true" />
      </button>}
      <section className="ss-home-saves" aria-labelledby="ss-home-saves-title">
        <div className="ss-home-saves__heading"><div><h2 id="ss-home-saves-title">Saved scans</h2><p>{session ? "Private to your account." : "Save and reopen your spaces with an account."}</p></div>
          <button type="button" className="ss-home-manage" onClick={onManage} aria-label="Rooms saved on this device" title="Rooms saved on this device"><DotsThree size={25} weight="bold" aria-hidden="true" /></button></div>
        {listError && projectOwner === uid && !deleteChoice && <div className="ss-home-error" role="alert"><p>{listError}</p><button type="button" onClick={() => setRetry((value) => value + 1)} disabled={Boolean(openingProject)}>Try again</button></div>}
        {initializing || profileLoading || (accountReady && visibleProjects === null) ? <div className="ss-home-empty" role="status"><p>Loading saved scans…</p></div> : !accountReady ? <div className="ss-home-empty"><FolderOpen size={32} aria-hidden="true" /><h3>{session ? "Verify email to see your scans" : "Sign in to see your scans"}</h3><p>Your saved originals will be available on your account.</p><Link className="ss-home-sign-in" to={session ? "/verify-email" : "/login"} state={{ from: "/scanspace" }}>{session ? "Verify email" : "Sign in to your account"}<ArrowRight size={16} aria-hidden="true" /></Link></div> : null}
        {visibleProjects?.length === 0 && !listError && <div className="ss-home-empty"><FolderOpen size={32} aria-hidden="true" /><h3>No saved scans yet</h3><p>Create a scan to start planning your space.</p></div>}
        {visibleProjects?.length > 0 && <div className="ss-home-projects">{visibleProjects.map((project) => <article className="ss-home-project-wrap" key={project.id}><button type="button" className="ss-home-project" onClick={() => openProject(project)} disabled={Boolean(openingProject) || project.status !== "ready"} aria-label={`Open ${project.name}`}>
          <span className="ss-home-room-icon"><Cube size={24} aria-hidden="true" /></span><strong>{project.name}</strong><small>{openingProject === project.id ? "Opening…" : project.status !== "ready" ? "Incomplete save" : `Saved ${savedDate(project.updatedAt)}`}<span className="ss-home-file-size">{scanFileSize(project.byteSize)}</span></small><ArrowRight size={18} aria-hidden="true" />
        </button><button type="button" className="ss-home-project-delete" aria-label={`Delete ${project.name}`} disabled={project.status === "uploading" || Boolean(openingProject)} onClick={() => { setListError(""); setDeleteChoice(project); }}><Trash size={18} aria-hidden="true" /></button></article>)}</div>}
      </section>
    </div>
    <dialog ref={startDialog} className="ss-home-start" aria-labelledby="ss-home-start-title" onCancel={() => setStartOpen(false)} onClose={() => setStartOpen(false)}>
      <header><div><h2 id="ss-home-start-title">Create a space</h2><p>Choose how to get started.</p></div><button type="button" onClick={() => setStartOpen(false)} aria-label="Close new scan"><X size={20} aria-hidden="true" /></button></header>
      <div className="ss-home-methods">
        <button type="button" onClick={() => choose(onScan)} disabled={!capabilities?.ar} aria-describedby={!capabilities?.ar ? "ss-home-camera-hint" : undefined}><Camera size={24} aria-hidden="true" /><span><strong>Scan a room</strong><small>Capture your room with your camera.</small></span><ArrowRight size={18} aria-hidden="true" /></button>
        {!capabilities?.ar && <p id="ss-home-camera-hint">{!capabilities ? "Checking camera scanning support…" : capabilities.secure === false ? "Open ScanSpace over HTTPS to use camera scanning." : "Camera scanning needs a compatible Android phone."}</p>}
        <button type="button" onClick={() => choose(onMeasure)}><Ruler size={24} aria-hidden="true" /><span><strong>Enter measurements</strong><small>Set your room’s size by hand.</small></span><ArrowRight size={18} aria-hidden="true" /></button>
        <button type="button" onClick={() => fileInput.current?.click()}><UploadSimple size={24} aria-hidden="true" /><span><strong>Import a scan</strong><small>Open a ScanSpace JSON file.</small></span><ArrowRight size={18} aria-hidden="true" /></button>
        <input ref={fileInput} type="file" aria-label="ScanSpace file" accept="application/json,.json" hidden onChange={(event) => { if (event.currentTarget.files?.length) { setStartOpen(false); onImport(event); } }} />
      </div>
    </dialog>
    <dialog ref={deleteDialog} className="ss-home-start ss-home-delete-dialog" aria-labelledby="ss-home-delete-title" onCancel={event => { if (deleting) event.preventDefault(); else setDeleteChoice(null); }} onClose={() => setDeleteChoice(null)}>
      <header><div><h2 id="ss-home-delete-title">Delete this scan?</h2><p>{deleteChoice?.name} and its original file will be removed from your account.</p></div></header>
      {listError && <p role="alert" className="ss-home-error">{listError}</p>}
      <div className="ss-actions"><button type="button" disabled={deleting} onClick={() => setDeleteChoice(null)}>Cancel</button><button type="button" className="ss-home-delete-confirm" disabled={deleting} onClick={removeProject}>{deleting ? "Deleting…" : "Delete scan"}</button></div>
    </dialog>
  </>;
}

export default function ScanSpaceWelcome(props) {
  return <CustomerAuthBoundary><Welcome {...props} /></CustomerAuthBoundary>;
}
