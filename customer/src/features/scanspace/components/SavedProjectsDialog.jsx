import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Copy,
  DeviceMobile,
  LinkSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import { api } from "../services";

function transferLink(code) {
  const url = new URL("/scanspace", window.location.origin);
  url.searchParams.set("transfer", code);
  return url.toString();
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

function errorMessage(reason) {
  if (reason?.name === "AbortError")
    return "The request took too long. Check your connection and try again.";
  if (reason instanceof TypeError)
    return "Saved rooms are unavailable right now. Check your connection and try again.";
  return reason?.message || "ScanSpace could not complete that request. Try again.";
}

export default function SavedProjectsDialog({
  onClose,
  onLoad,
  currentProjectId = null,
  onDeleted = () => {},
}) {
  const [projects, setProjects] = useState(null);
  const [code, setCode] = useState("");
  const [transfer, setTransfer] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const closeButton = useRef(null);
  const normalizedCode = useMemo(
    () => code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
    [code],
  );

  const refreshProjects = useCallback(async () => {
    setProjects(null);
    setError("");
    try {
      setProjects(await api("/projects"));
    } catch (reason) {
      setProjects([]);
      setError(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    refreshProjects();
    closeButton.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, refreshProjects]);

  async function load(project) {
    setBusy(`load:${project._id}`);
    setError("");
    try {
      onLoad(await api(`/projects/${project._id}`));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  async function createTransfer(project) {
    setBusy(`transfer:${project._id}`);
    setNotice("");
    setError("");
    try {
      const result = await api(`/projects/${project._id}/transfer`, {}, "POST");
      setTransfer({
        ...result,
        projectId: project._id,
        projectName: project.name,
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  async function shareTransfer() {
    const url = transferLink(transfer.code);
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Open ${transfer.projectName} in ScanSpace`,
          text: `Open this saved ScanSpace room on your other device. The link works once for one hour. Code: ${transfer.code}`,
          url,
        });
        setNotice("Transfer link ready to send.");
      } else {
        await copyText(url);
        setNotice("Transfer link copied.");
      }
    } catch (reason) {
      if (reason.name !== "AbortError") setError("The link could not be shared. Copy the code instead.");
    }
  }

  async function claim(event) {
    event.preventDefault();
    if (normalizedCode.length !== 12) {
      setError("Enter all 12 characters from the other device.");
      return;
    }
    setBusy("claim");
    setNotice("");
    setError("");
    try {
      onLoad(await api("/transfers/claim", { code: normalizedCode }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  async function remove(project) {
    setBusy(`delete:${project._id}`);
    setError("");
    try {
      await api(`/projects/${project._id}`, null, "DELETE");
      setProjects((items) => items.filter((item) => item._id !== project._id));
      onDeleted(project._id);
      if (transfer?.projectId === project._id) setTransfer(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="ss-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-saved-title"
        className="ss-project-dialog"
      >
        <header>
          <div>
            <h2 id="ss-saved-title">Saved rooms</h2>
            <p>Continue here, or bring a room over from another device.</p>
          </div>
          <button ref={closeButton} onClick={onClose} aria-label="Close saved rooms">
            <X size={20} />
          </button>
        </header>

        {error && (
          <p role="alert" className="ss-error">
            {error}
            {projects?.length === 0 && (
              <button type="button" onClick={refreshProjects}>Try again</button>
            )}
          </p>
        )}
        {notice && <p role="status" className="ss-notice">{notice}</p>}

        <section className="ss-transfer-panel" aria-labelledby="ss-transfer-title">
          <div className="ss-transfer-heading">
            <DeviceMobile size={22} />
            <div>
              <h3 id="ss-transfer-title">Open a room from your phone</h3>
              <p>Enter the one-time code shown on the device that saved it.</p>
            </div>
          </div>
          <form onSubmit={claim} className="ss-transfer-form">
            <label>
              Transfer code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="ABCD-EFGH-JKLM"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck="false"
                maxLength={14}
              />
            </label>
            <button className="ss-primary" disabled={busy === "claim" || normalizedCode.length !== 12}>
              {busy === "claim" ? "Opening…" : "Open room"}
              {busy !== "claim" && <ArrowRight size={17} />}
            </button>
          </form>
          {transfer && (
            <div className="ss-transfer-ready" role="status">
              <span>One-time code for {transfer.projectName}</span>
              <output>{transfer.code}</output>
              <p>
                Use it within one hour. The editable room is copied to the other
                browser; camera textures stay on this device.
              </p>
              <div>
                <button type="button" className="ss-primary" onClick={shareTransfer}>
                  <LinkSimple size={17} />
                  Share transfer link
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await copyText(transfer.code);
                      setNotice("Transfer code copied.");
                    } catch {
                      setError("The code could not be copied. Select it manually.");
                    }
                  }}
                >
                  <Copy size={17} />
                  Copy code
                </button>
              </div>
            </div>
          )}
        </section>

        <div className="ss-project-list-heading">
          <h3>Saved in this browser</h3>
          <span>{projects?.length || 0} of 30</span>
        </div>
        {projects === null && <p className="ss-empty">Loading your saved rooms…</p>}
        {projects?.length === 0 && !error && (
          <p className="ss-empty">No cloud rooms are connected to this browser yet.</p>
        )}
        {projects?.map((project) => (
          <div className="ss-project-row" key={project._id}>
            <button
              onClick={() => load(project)}
              disabled={!!busy}
              aria-current={currentProjectId === project._id ? "true" : undefined}
            >
              <strong>{project.name}</strong>
              <small>
                {currentProjectId === project._id ? "Open now · " : ""}
                Saved {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(project.updatedAt))}
              </small>
            </button>
            <button
              className="ss-transfer-action"
              aria-label={`Send ${project.name} to another device`}
              title="Send to another device"
              disabled={!!busy}
              onClick={() => createTransfer(project)}
            >
              <LinkSimple size={18} />
              <span>Use on PC</span>
            </button>
            <button
              aria-label={`Delete ${project.name}`}
              title="Delete saved room"
              disabled={!!busy}
              onClick={() => remove(project)}
            >
              <Trash size={18} />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
