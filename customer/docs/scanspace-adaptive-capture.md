# Adaptive capture

The live scanner keeps a bounded, connected graph of saved depth views. This
improves **future captures**; it cannot recover measurements missing from an old
export or guarantee a closed mesh of unseen object faces.

- Bootstrap needs two translated views with bidirectional depth agreement. The
  initial anchor stays fixed during tiny steps so a very slow sweep can start.
- Timing, sample density, pose spacing, and motion limits adapt to reported depth
  type/resolution, measured depth quality, scene detail, and processing cost.
- Every XR pose contributes to a short motion window, so an out-and-back shake
  cannot hide between depth samples. RGB readback is throttled independently.
- A motion/quality skip is not a tracking failure. Brief skips leave the saved
  map and recent recovery evidence intact. A new non-conflicting overlap miss
  starts a 900 ms checking grace period; the view stays provisional throughout.
  Tracking loss, a camera jump, or contradictory geometry clears recovery
  evidence immediately. An XR reference-space reset still requires a new scan.
- Recovery keeps reading the sensor. It needs two reliable observations at
  least 120 ms apart, within 1.8 seconds, agreeing with both the saved map and
  each other. A soft skip between them does not reset confirmation, but stale
  evidence, another overlap miss, or a hard tracking/geometry failure does.
  Existing bidirectional support and residual limits are unchanged.
- Unconnected observations stay out of the saved surface and confirmed preview.
  At most six are held for eight seconds, with no extra sensor-frame history.
  Redundant views are discarded first, and capacity eviction protects the most
  promising bridge back to the saved map. Every promotion must independently
  pass the original geometry tests. Drop causes are counted separately.
- At the 60-view limit, only graph-safe redundant views can be removed. If none
  can be removed safely, the user is prompted to save this section.
- The live progress panel separates accepted room-direction sweep from confirmed
  overlap on observed surfaces. Unseen regions remain "Not seen", completed
  lower/wall/upper regions stay marked as covered, and the weakest area becomes
  the next suggested target. Routine view checking is a passive saved-state
  update rather than a replacement for the primary scanning instruction.
  Sharing a voxel is not sufficient confirmation: the depth must agree along
  the projected camera ray. Current-view confirmation needs two independently
  positioned, retained depth views; a stationary unsaved frame cannot add votes.
- One primary instruction is shown at a time. Non-critical warnings wait 1.8
  seconds and repeated prompts have a 4.5-second cooldown. A completed-area
  message remains visible for four seconds, while a sustained warning can still
  replace it. The amber target is only shown with directional reconnection
  guidance, never as a routine coverage obligation. Coordinate-reset warnings
  are immediate.
- Review builds the saved, connected result directly and shows an orbitable
  preview before asking to save or continue. Coverage/alignment concerns remain
  in an expandable audit, with explicit partial save. Separate furniture alone
  is not treated as failed capture. Continue preserves the raw observations;
  save reuses the checked mesh instead of reconstructing twice. A closed camera
  session or preview-render failure does not remove the save option.
- Raw exports retain capture IDs, validated links, and a bounded quality summary.
  Imported links are diagnostic metadata, never a substitute for reconstruction
  validation. Provisional observations are not exported as confirmed geometry.
- Development-only local diagnostics include per-reason decisions, useful commits,
  elapsed/active/recovery time, prompt counts, age/capacity/redundancy drops,
  actual motion-gate peaks and thresholds, and sampled motion for comparison.
  Only the last 48 decision summaries are retained, without images or camera
  coordinates. Old exports without these fields remain importable.

## Automated checks

```powershell
node node_modules/react-scripts/scripts/test.js --watchAll=false --runInBand src/features/scanspace
node node_modules/react-scripts/scripts/build.js
node scripts/replay-adaptive-capture.cjs "C:/path/to/raw-scan.json"
```

The replay independently checks every retained link and asserts the graph and
memory limits after every observation. It is deliberately **not** a camera test:
old files omit rejected frames and the high-rate pose stream, and a recording
cannot respond to the new recovery guidance.

## Capture-control layout checks

```powershell
node scripts/preview-capture-feedback.cjs
```

This serves static snapshots of the actual capture components and stylesheet
at `http://127.0.0.1:3977/layout`, including `/start`, `/tracking`, `/checking`,
`/motion`, `/recovering`, and `/review`. Sensor values and the review scene are simulated;
action buttons are non-interactive snapshots, and no camera or scan files are
accessed. Restart after JSX edits; CSS is read on each request.
Use the component tests for button behavior and a real phone for sensor checks.

Browser layout checks at 360 × 640, 320 × 568, and 640 × 360 verify that guidance
does not overlap the coverage display and that the relevant action buttons stay
within the viewport. Short-screen layouts use flowing guidance; landscape review
puts the preview and save controls side by side. Expanded details may scroll.

## Phone acceptance check

Test a continuous sideways sweep, stationary hold, quick turn, out-and-back
shake, tracking loss/return, and a scan longer than 60 views. Confirm that recovery
does not stop depth acquisition, ambiguous frames never paint confirmed coverage,
and capture resumes after validated overlap. Check an upper surface, floor/wall
join, and object silhouette from the front and both sides in the final preview.
Exercise both Keep scanning and Save partial scan after a failed review.

Repeat brief motion skips during recovery, a depth interruption, and an actual
coordinate reset. A brief skip should not produce repeated slowdown/amber loops;
real disconnected or contradictory depth must still stay out of the saved graph.
Review should be available even while the latest view is still unconfirmed.

Repeat on raw-depth and smooth-depth devices, including a mid-range phone.
Inspect capture interval, processing cost, retained/provisional views, and final
alignment warnings. Compare time and prompt count to achieve equivalent observed
coverage, not simply rejection percentage or frame count. Use the same room and
comparable routes, and verify retained-link residuals and multi-angle mesh quality.
The timing defaults need hardware validation; desktop tests and saved-only replay
do not establish device FPS, sensor accuracy, texture sharpness, or faster scans.
