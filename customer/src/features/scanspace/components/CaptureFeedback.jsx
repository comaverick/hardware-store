const names = { upper: "Upper surfaces", middle: "Walls & objects", lower: "Lower surfaces" };

export function CaptureCoverage({ coverage }) {
  return (
    <div className="ss-connected-coverage" aria-label="Coverage of observed surfaces">
      {(coverage?.regions || ["lower", "middle", "upper"].map(id => ({ id, observed: 0 }))).map(region => (
        <div key={region.id}>
          <span>{names[region.id]}</span>
          <strong>{region.observed ? `${Math.round(region.ratio * 100)}% confirmed` : "Not seen"}</strong>
          <progress aria-label={`${names[region.id]} confirmed`} max="100" value={region.observed ? Math.round(region.ratio * 100) : 0} />
        </div>
      ))}
    </div>
  );
}

export function CaptureAuditNotice({ audit, onContinue, onSave, saving = false, canContinue = true }) {
  return (
    <section className={`ss-partial-capture ${audit.passed ? "is-ready" : ""}`} role="status" aria-label="Capture review">
      <strong>{audit.passed ? "Ready to save" : "Your captured area is ready to review"}</strong>
      <p>{audit.passed ? "Look around the preview, then save or add more coverage."
        : "Some areas may be incomplete. You can save this partial scan or keep scanning."}</p>
      {!canContinue && <p>The camera session cannot continue. You can still save this captured result.</p>}
      {!!audit.issues.length && <details>
        <summary>Areas you can improve</summary>
        <ul>{audit.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
      </details>}
      <div className="ss-actions">
        <button type="button" disabled={saving || !canContinue} onClick={onContinue}>Keep scanning</button>
        <button type="button" className="ss-primary" disabled={saving} onClick={onSave}>{audit.passed ? "Save scan" : "Save partial scan"}</button>
      </div>
    </section>
  );
}
