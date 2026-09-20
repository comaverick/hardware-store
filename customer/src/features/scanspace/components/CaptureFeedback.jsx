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

export function CaptureAuditNotice({ audit, onContinue, onSave, saving = false }) {
  return (
    <section className="ss-partial-capture" role="status" aria-label="Capture review">
      <strong>A few areas need another look</strong>
      <ul>{audit.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
      <p>Your connected views are still available. Add coverage or save them as a partial scan.</p>
      <div className="ss-actions">
        <button type="button" className="ss-primary" disabled={saving} onClick={onContinue}>Keep scanning</button>
        <button type="button" disabled={saving} onClick={onSave}>Save partial scan</button>
      </div>
    </section>
  );
}
