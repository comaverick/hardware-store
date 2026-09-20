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
- Unconnected observations stay out of the surface and preview. At most six are
  held for eight seconds. Recovery keeps reading the sensor and needs two
  consecutive reliable observations; buffered views are independently rechecked
  before joining. An XR reference-space reset requires a new scan.
- At the 60-view limit, only graph-safe redundant views can be removed. If none
  can be removed safely, the user is prompted to save this section.
- Coverage describes observed surfaces, not a percentage of the entire room.
  Unseen regions remain "Not seen". Amber guidance points toward a revisit area.
  Sharing a voxel is not sufficient confirmation: the depth must agree along
  the projected camera ray. Current-view confirmation needs two independently
  positioned, retained depth views; a stationary unsaved frame cannot add votes.
- Review checks live overlap first and reconstruction diagnostics second. Suspect
  alignment or missing-depth results require another pass or an explicit partial
  save. Separate furniture components alone are not treated as failed capture.
- Raw exports retain capture IDs, validated links, and a bounded quality summary.
  Imported links are diagnostic metadata, never a substitute for reconstruction
  validation. Provisional observations are not exported as confirmed geometry.

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
at `http://127.0.0.1:3977/tracking`, `/recovering`, and `/review`. Sensor values
are simulated, the buttons are non-interactive snapshots, and no camera or
scan files are accessed. Restart after JSX edits; CSS is read on each request.
Use the component tests for button behavior and a real phone for sensor checks.

Browser layout checks at 360 × 640, 320 × 568, and 640 × 360 verify that guidance
does not overlap the coverage display and that the relevant action buttons stay
within the viewport. Short-screen layouts use flowing guidance; landscape puts
coverage groups side by side and keeps actions visible.

## Phone acceptance check

Test a continuous sideways sweep, stationary hold, quick turn, out-and-back
shake, tracking loss/return, and a scan longer than 60 views. Confirm that recovery
does not stop depth acquisition, ambiguous frames never paint confirmed coverage,
and capture resumes after validated overlap. Check an upper surface, floor/wall
join, and object silhouette from the front and both sides in the final preview.
Exercise both Keep scanning and Save partial scan after a failed review.

Repeat on raw-depth and smooth-depth devices, including a mid-range phone.
Inspect capture interval, processing cost, retained/provisional views, and final
alignment warnings. Thresholds need hardware validation; desktop tests do not
establish device FPS, sensor accuracy, or texture sharpness.
