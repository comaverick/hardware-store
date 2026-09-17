const RENDER_STAGES = [
  { key: "preparing", label: "Frames", message: "Checking the captured depth and camera frames." },
  { key: "fusing", label: "Depth", message: "Aligning overlapping depth measurements." },
  { key: "meshing", label: "Surface", message: "Building a continuous measured surface." },
  { key: "texturing", label: "Color", message: "Applying the clearest captured camera colors." },
];

function normalizedStage(stage) {
  const value = String(stage || "preparing").toLowerCase();
  if (value.includes("retry")) return "fusing";
  return RENDER_STAGES.some((item) => item.key === value)
    ? value
    : "preparing";
}

export function scanRenderStage(stage) {
  const key = normalizedStage(stage);
  return RENDER_STAGES.find((item) => item.key === key);
}

export default function ScanRenderProgress({
  stage = "preparing",
  progress,
  title = "Rendering your scan",
  detail = "Keep this page open while ScanSpace rebuilds the captured result.",
  variant = "page",
}) {
  const current = scanRenderStage(stage);
  const currentIndex = RENDER_STAGES.findIndex((item) => item.key === current.key);
  const determinate = progress != null && Number.isFinite(Number(progress));
  const value = determinate
    ? Math.max(0, Math.min(100, Math.round(Number(progress))))
    : null;

  return (
    <section
      className={`ss-render-progress ss-render-progress--${variant}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="ss-render-progress__heading">
        <div>
          <h2>{title}</h2>
          <p>{current.message}</p>
        </div>
        {value != null && (
          <strong className="ss-render-progress__value" aria-hidden="true">
            {value}%
          </strong>
        )}
      </div>
      <div
        className={`ss-render-progress__track${determinate ? "" : " is-indeterminate"}`}
        role="progressbar"
        aria-label="Scan rendering progress"
        aria-valuemin="0"
        aria-valuemax="100"
        {...(value == null ? {} : { "aria-valuenow": value })}
      >
        <span
          style={
            value == null ? undefined : { transform: `scaleX(${value / 100})` }
          }
        />
      </div>
      <ol className="ss-render-progress__stages" aria-label="Rendering steps">
        {RENDER_STAGES.map((item, index) => (
          <li
            key={item.key}
            className={
              index < currentIndex
                ? "is-complete"
                : index === currentIndex
                  ? "is-current"
                  : ""
            }
            aria-current={index === currentIndex ? "step" : undefined}
          >
            <i aria-hidden="true" />
            <span>{item.label}</span>
          </li>
        ))}
      </ol>
      <p className="ss-render-progress__detail">{detail}</p>
    </section>
  );
}
