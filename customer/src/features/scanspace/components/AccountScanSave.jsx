import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FloppyDisk } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { CustomerAuthBoundary, useCustomerAuth } from "../../../auth/CustomerAuthContext";
import { serializeScan } from "../core/partialScanFile";
import { pendingAccountScan, saveAccountScan, updateAccountScan } from "../accountScans";
import "../account-scans.css";

function Save({ source, metadata, onSaved, beforeSave }) {
  const { session, initializing, profileLoading } = useCustomerAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef(null), original = useRef(null), pending = useRef(null), mounted = useRef(false);
  const uid = session?.user?.uid || "";
  const uidRef = useRef(uid); uidRef.current = uid;
  const ownedRecord = source?.account?.ownerUid === uid ? source.account : null;
  const anotherAccount = Boolean(source?.account?.ownerUid && source.account.ownerUid !== uid);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  useEffect(() => {
    pending.current?.abort(); pending.current = null;
    original.current = null;
    setOpen(false); setBusy(false); setNotice(""); setError("");
  }, [uid, source?.original, source?.file]);
  useEffect(() => {
    if (!open) { dialog.current?.close?.(); return; }
    dialog.current?.showModal?.();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  async function prepare() {
    if (original.current) return original.current;
    await new Promise(resolve => setTimeout(resolve, 0));
    const file = source.file || new Blob([
      source.kind === "scan" ? serializeScan({ ...source.original, customization: null }) : JSON.stringify(source.original),
    ], { type: "application/json" });
    const bytes = window.crypto.getRandomValues(new Uint8Array(24));
    original.current = { file, requestKey: Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("") };
    return original.current;
  }
  async function begin() {
    if (busy || pending.current) return;
    setError(""); setNotice("");
    if (session?.emailVerified) { setName(ownedRecord?.name || metadata.name || "My space"); setOpen(true); return; }
    setBusy(true);
    const accountAtStart = uid;
    try {
      const { file } = await prepare();
      await beforeSave?.();
      await pendingAccountScan("put", { file, kind: source.kind, metadata, ownerUid: accountAtStart, createdAt: new Date().toISOString() });
      if (mounted.current && uidRef.current === accountAtStart)
        navigate(session ? "/verify-email" : "/login", { state: { from: "/scanspace?resume=account-save" } });
    } catch (reason) {
      if (mounted.current) setError(reason.message || "Export this scan before signing in; browser storage could not preserve it.");
    } finally { if (mounted.current) setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (pending.current || !name.trim()) return;
    const accountAtStart = uid;
    const user = session.user;
    const controller = new AbortController(); pending.current = controller;
    const isCurrent = () => mounted.current && uidRef.current === accountAtStart && !controller.signal.aborted;
    setBusy(true); setError("");
    try {
      const values = { ...metadata, kind: source.kind, name: name.trim() };
      await beforeSave?.();
      let record;
      if (ownedRecord) record = await updateAccountScan(user, ownedRecord, values, controller.signal);
      else {
        const { file, requestKey } = await prepare();
        record = await saveAccountScan(user, file, values, requestKey, controller.signal);
      }
      if (isCurrent()) {
        onSaved?.({ ...record, ownerUid: accountAtStart });
        setOpen(false); setNotice("Saved to your account.");
      }
    } catch (reason) {
      if (isCurrent()) setError(reason.message || "The save was interrupted. Your original is still here; try again.");
    } finally {
      if (pending.current === controller) pending.current = null;
      if (isCurrent()) setBusy(false);
    }
  }
  return <>
    <button type="button" className="ss-primary" onClick={begin} disabled={busy || initializing || profileLoading || anotherAccount}>
      <FloppyDisk size={18} aria-hidden="true" />
      <span>{anotherAccount ? "Open a scan from your account" : busy ? "Saving…" : initializing || profileLoading ? "Loading account…" : !session ? "Sign in to save" : !session.emailVerified ? "Verify email to save" : "Save to account"}</span>
    </button>
    {notice && <span className="ss-account-save-feedback" role="status">{notice}</span>}
    {error && !open && <p className="ss-error" role="alert">{error}</p>}
    <dialog ref={dialog} className="ss-account-save-dialog" aria-labelledby="ss-account-save-title" onCancel={event => { if (busy) event.preventDefault(); else setOpen(false); }} onClose={() => setOpen(false)}>
      <form onSubmit={save}>
        <header><h2 id="ss-account-save-title">Save your space</h2><button type="button" disabled={busy} aria-label="Close save" onClick={() => setOpen(false)}><X size={20} /></button></header>
        <p>Your original file stays private to your account. Finish edits are saved separately.</p>
        <label htmlFor="ss-account-scan-name">Name</label>
        <input id="ss-account-scan-name" value={name} maxLength={120} required autoFocus disabled={busy} onChange={event => setName(event.target.value)} />
        {error && <p role="alert" className="ss-error">{error}</p>}
        {busy && <p role="status">Saving your original file… Keep this page open.</p>}
        <div className="ss-actions"><button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="ss-primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save"}</button></div>
      </form>
    </dialog>
  </>;
}

export default function AccountScanSave(props) {
  return <CustomerAuthBoundary><Save {...props} /></CustomerAuthBoundary>;
}
