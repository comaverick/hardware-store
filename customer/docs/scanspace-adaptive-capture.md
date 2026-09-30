# Adaptive capture

The live scanner keeps a bounded, connected graph of saved depth views. This
improves **future captures**; it cannot recover measurements missing from an old
export or guarantee a closed mesh of unseen object faces.

- Bootstrap needs two translated views with bidirectional depth agreement. The
  initial anchor stays fixed during tiny steps so a very slow sweep can start.
  Narrow connections to the saved map keep their initial bridge pose fixed too;
  continuous millimetre-sized steps accumulate toward the required 4 cm baseline.
- A starting pair that contradicts every fresh view no longer traps the scan.
  While exactly two views are saved, up to three fresh observations are checked
  over at least 240 ms and within 1.8 seconds. All three positions must be at
  least 4 cm apart, with strong distributed bidirectional agreement between
  every pair. Only then can they replace the contradicted starting pair, once
  per session. Stationary repeats, inconsistent depth, weak overlap, and hard
  tracking interruptions cannot combine into a repair. Established maps remain
  protected. Obsolete splats and textures are cleared immediately, and replaced
  starting views are subtracted from the saved-view count.
- Timing, sample density, pose spacing, and motion limits adapt to reported depth
  type/resolution, measured depth quality, scene detail, and processing cost.
- Every XR pose contributes to a short motion window, so an out-and-back shake
  cannot hide between depth samples. Fast-motion rejection happens before
  sampling the depth grid or reading RGB. Ordinary sweeps can exceed preferred
  motion speeds while still needing measured geometry agreement; hard limits
  range from 0.65–0.85 m/s and 0.9–1.2 rad/s according to depth quality. RGB
  keeps its stricter motion and focus gates. Patchy and obstructed depth skips RGB.
  Sharp stationary images refresh at most every 1.8 seconds; translated or
  rotated views can read sooner. Moderate movement reads at most once a second
  and still needs the existing measured-focus check to retain a texture.
  Each retained image keeps its own camera pose. Depth acquisition continues
  independently, and unchanged preview geometry is not rebuilt every frame.
- A motion/quality skip is not a tracking failure. Brief skips leave the saved
  map and recent recovery evidence intact. A new non-conflicting overlap miss
  starts a 900 ms checking grace period; the view stays provisional throughout.
  Tracking loss, a camera jump, or contradictory geometry clears recovery
  evidence immediately. An XR reference-space reset still requires a new scan.
- Recovery keeps reading the sensor. It needs two reliable observations at
  least 120 ms apart, within 1.8 seconds, agreeing with both the saved map and
  each other. A soft skip between them does not reset confirmation, but stale
  evidence or a hard tracking/geometry failure does.
  Existing bidirectional support and residual limits are unchanged.
- Starting and connection checks use a shorter retry interval, normally
  120–250 ms, increasing to 1.5 times measured processing cost on slower
  devices (capped at 600 ms). A connected recent pair separated by at least
  4 cm can outweigh an older contradiction only when agreeing references
  outnumber conflicting references and every conflicting reference predates
  that pair. A contradiction with a recent view, or just one agreeing view,
  still blocks admission. Every new graph edge passes the original depth test.
- Unconnected observations stay out of the saved surface and confirmed preview.
  At most six are held for eight seconds, with no extra sensor-frame history.
  Redundant views are discarded first, and capacity eviction protects the most
  promising bridge back to the saved map. Every promotion must independently
  pass the original geometry tests. Drop causes are counted separately.
- The retained pool remains capped at 60 views. Redundant views can be removed
  when the remaining graph stays connected, including through new direct links
  that independently pass the original bidirectional geometry checks. The
  shortcut search is bounded; an irreplaceable chain still prompts a section
  save. This does not add unlimited room chunks or discard distinct surfaces
  merely to keep the counter moving.
- Periodic observed-coverage and surface analysis runs in a worker. It keeps
  geometry for at most 60 retained views, receives only changed views, and uses
  one in-flight job plus one latest queued request. Transferable copies preserve
  the main scan arrays; camera images and XR sensor handles never enter the
  worker. Removed or replaced source views invalidate old results. Worker
  failure falls back to periodic inline coverage, and review always checks the
  exact current retained graph.
- A bounded surface model checks only measured wall, floor, or ceiling cells
  supported by three views separated by at least 6 cm. Floor/ceiling labels
  require a known floor height. At least 85% of the current measured samples
  must belong to checked cells before a stable, low-detail surface uses wider
  pose spacing. New extensions, foreground layers, noisy depth, and detailed
  objects still need their normal observations. This never fills unseen mesh
  gaps or treats an entire plane rectangle as captured.
- The live progress panel reports cumulative saved views and overlap on
  observed surfaces. It does not show an inferred whole-room completion
  percentage. Unseen regions remain "Not seen"; observed lower/wall/upper
  regions show "Partial" or "Checked". Routine view checking is a passive
  saved-state update rather than a second scanning instruction.
  Sharing a voxel is not sufficient confirmation: the depth must agree along
  the projected camera ray. Current-view confirmation needs two independently
  positioned, retained depth views; a stationary unsaved frame cannot add votes.
- One primary instruction is shown at a time. Non-critical warnings wait 1.8
  seconds and repeated prompts have a 4.5-second cooldown. A completed-area
  message can remain visible for four seconds, but clears when the current view
  becomes unconfirmed. After two seconds without a useful saved view, guidance
  describes the needed sideways step or shared edge. A prolonged connection
  stall, including contradictory depth, escalates to a wider view after four
  seconds. Start rechecking asks for a continuous sideways sweep. The amber target uses an
  actual matching depth point where available and appears only during actionable
  reconnection. Coordinate-reset warnings are immediate.
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
  Decision timings separate depth sampling/preparation, RGB readback, overlap,
  and confirmation. The local panel also reports worker/preview processing,
  skipped grids, checked surfaces, and validated graph shortcuts.
  Starting-pair repairs, discarded seed views, and recent agreement overrides
  are also counted and survive raw export/import.
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
`/motion`, `/recovering`, `/seed-recheck`, `/bridge`, `/reposition`, `/surface`, and `/review`.
Sensor values and the review scene are simulated;
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

On the POCO X6 in Chrome, repeat the recorded wall-to-ceiling transition with
tiny continuous sideways steps. Check that useful views resume without a
repeated hold/align loop, and that a wider-view prompt appears for a prolonged
overlap miss. A checked wall patch should not demand dense repeat passes;
an unseen extension and an object in front must still require new measurements.
After a stationary depth refresh or floor-height correction, previously checked
surface patches must be reanalysed before guiding capture again.

Repeat the September 30 recordings that stopped at two saved views. Sweep
sideways across the same wall and shelf without deliberate holds. Fresh stable
depth should repair a contradicted start and the saved count should continue
growing. Confirm the discarded seed splats disappear and inspect the repaired
wall from the side in review. If the sensor stays inconsistent, actionable
guidance should change within four seconds rather than repeating alignment
instructions indefinitely. Timing on the phone still needs a physical test;
synthetic recovery timing does not establish device scan speed.

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
The wall/room timing goals are acceptance targets, not measured improvements.
