# Adaptive capture

The live scanner retains a bounded sequence of depth views using WebXR camera
tracking. Geometric overlap is independently validated during reconstruction,
rather than blocking acquisition when the camera moves to another area. Missing
measurements cannot be recovered from old exports, and unseen surfaces remain open.

- Bootstrap needs two usable, translated views. The
  initial anchor stays fixed during tiny steps so a very slow sweep can start.
- Timing, sample density, pose spacing, and motion limits adapt to reported depth
  type/resolution, measured depth quality, scene detail, and processing cost.
- Every XR pose contributes to a short motion window, so an out-and-back shake
  cannot hide between depth samples. RGB readback is throttled independently.
- Live acquisition does not run saved-map overlap comparisons, old-reference
  conflict vetoes, bridge confirmation, capture-gap recovery, or repeated
  reconnection confirmation. RoomScanner uses `validateOverlap: false`; the
  original strict mode remains available to legacy replay and regression checks.
- Invalid/missing depth, sparse measurements, nearby obstruction, excessive motion,
  deliberate pause, and lost/emulated tracking still withhold geometry. A sudden
  camera jump skips that observation. The next usable tracked view resumes capture
  without needing to match an older saved surface. An XR reference-space reset
  still stops the scan and requires a new session.
- When depth is temporarily missing, the scanner probes each tracked XR callback
  until a real depth update arrives. A depth object is only read during its own
  active XR frame. Fixed-interval retries can miss intermittent frame updates;
  normal grid sampling and RGB timing resume after the signal returns. Null
  probes skip geometry, image readback and plane updates. Depth API exceptions
  retain a bounded retry interval. Persistent absence still produces a warning
  and keeps the captured views available to review; it is never filled with
  fabricated depth.
- Pending views are used only during startup and remain bounded to six views for
  eight seconds. After startup, usable novel views are retained immediately.
  Capture links in `xr-tracking` mode describe native trajectory continuity;
  they do not certify geometric depth agreement.
- The scanner retains at most 60 depth views and keeps acquiring new viewpoints.
  At capacity it removes a redundant interior view, balancing position and turn
  spacing along the whole retained trajectory. The initial and latest translated
  pairs stay pinned, as do photo views while other depth candidates are available.
  Corners and direction reversals receive higher retention priority. Native
  trajectory links are spliced around the removed view; reconstruction still
  checks actual depth overlap independently. The preview is rebuilt in batches,
  and review/export always rebuild from the exact retained views. Longer scans
  have a more sparsely sampled path, so overlapping passes remain useful.
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
- Review validates geometric overlap, refines alignment, and builds the saved
  result using the existing reconstruction pipeline. It shows an orbitable
  preview before asking to save or continue. Coverage/alignment concerns remain
  in an expandable audit, with explicit partial save. Separate furniture alone
  is not treated as failed capture. Continue preserves the raw observations;
  save reuses the checked mesh instead of reconstructing twice. A closed camera
  session or preview-render failure does not remove the save option.
- Raw exports retain capture IDs, links, the `xr-tracking` or `depth-overlap`
  validation mode, and a bounded quality summary.
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

The replay exercises the original strict overlap mode, independently checks its
retained links, and asserts the graph and memory limits after every observation.
It is deliberately **not** a camera test:
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
and capture resumes after usable native tracking returns. Check an upper surface,
floor/wall join, and object silhouette from the front and both sides in the final preview.
Exercise both Keep scanning and Save partial scan after a failed review.
Capture more than 60 novel views, review, then select Keep scanning. New areas
should keep adding saved views without the section-capacity warning; the depth
buffer must remain bounded and the earlier, middle and latest areas represented.

Repeat brief motion skips, a depth interruption, and an actual coordinate reset.
Capture should resume on the next usable tracked view; turning to new areas must
not trigger a saved-map overlap loop. Review should reject unsupported or
contradictory depth instead of treating trajectory links as geometric proof.

Repeat on raw-depth and smooth-depth devices, including a mid-range phone.
Inspect capture interval, processing cost, retained/provisional views, and final
alignment warnings. Compare time and prompt count to achieve equivalent observed
coverage, not simply rejection percentage or frame count. Use the same room and
comparable routes, and verify retained-link residuals and multi-angle mesh quality.
The timing defaults need hardware validation; desktop tests and saved-only replay
do not establish device FPS, sensor accuracy, texture sharpness, or faster scans.
