# Continuous ScanSpace capture

## Plan

1. Separate retaining usable observations from confirming their registration.
2. Skip duplicate poses before expensive depth and RGB reads; retain a bounded,
   diverse path rather than stopping at the view limit.
3. Move overlap, coverage and preview confirmation to the existing worker.
4. Reconstruct every retained observation at review, recover coherent groups,
   and preserve excluded observations in raw exports.
5. Show captured progress independently of checked coverage; keep actionable
   prompts for actual sensor, motion and tracking failures.

## Current behavior

`RoomScanner` uses `ContinuousCapture`. Its pool contains at most 60 original
RGB-D geometry views and the existing separate, bounded pool of 15 photos.
Depth and photo poses remain synchronized. A view does not need to match the
first wall to enter the capture. Unreliable tracking, reference-space resets,
hard motion, missing depth and obstruction still gate acquisition.

Repeated poses skip grid sampling and RGB readback, with a depth refresh
opportunity after one second. A materially better repeat can replace the old
observation, which must be checked again. Rotation can capture a different
surface but cannot manufacture an independent translated viewpoint.

At capacity, retention preserves the first and newest two views and removes a
dense repeat, favoring pose diversity and depth support. Counts distinguish
all useful acquisitions from the number currently retained. This is bounded
capture, not unlimited room storage; very large scans may still lose fine
detail and connecting views as the pool is compacted.

The analysis worker compares a bounded temporal/spatial neighborhood using the
existing strict, bidirectional measured-depth checks. Comparisons are cached
and invalidated when either source changes or is evicted. The largest checked
component supplies checked coverage, plane analysis and green preview points.
An unrelated or contradictory group does not veto acquisition of later views.
There is one active worker job and one latest request; only changed geometry
copies are sent. Images and XR handles never enter this worker.

The faint blue preview shows recent captured observations. Green points and
coverage require repeat observations with translated cameras and projective
depth agreement. The counter says **Captured views**; it does not claim that
every captured view is aligned. Background alignment alone does not trigger a
stop, a reconnection target, or repeated wider-view instructions.
A mostly rotational sweep receives a gentle sideways-movement cue while capture
continues. Baseline uses all three position coordinates, so a vertical sweep
counts as translation too.

If live workers are unavailable, inline analysis is restricted to the most
recent eight views. Review still receives the full retained capture. The
existing reconstruction worker independently filters and aligns it, recovers
supported disconnected groups, refines poses, and rejects unsupported geometry.
Live links/status never replace final validation. A disconnected plain wall
cannot always constrain a unique pose correction; recovery must leave it out
when evidence is insufficient.

**Finish & review** becomes available with two retained depth views, even while
live alignment is pending. Final diagnostics report captured, live-checked,
finally validated and excluded views. A scan file preserves every retained
observation, including those excluded from the mesh. A failed reconstruction
offers **Download captured views** as well as continued capture.

The older `AdaptiveCapture` connected admission controller remains covered by
its existing tests and diagnostic replay. It no longer controls live scanning.
Its earlier design is described in `scanspace-adaptive-capture.md`.

## Verification

```powershell
node node_modules/react-scripts/scripts/test.js --watchAll=false --runInBand src/features/scanspace
node node_modules/react-scripts/scripts/build.js
node scripts/replay-continuous-capture.cjs "C:/path/to/raw-scan.json"
node scripts/preview-capture-feedback.cjs
```

Tests cover a contradicted starting pair, sustained unresolved registration,
stationary repeats, memory compaction, stale worker results, export/import and
final rejection of a shifted layer. Saved-file replay cannot reproduce rejected
sensor frames, actual XR callback cadence, or phone processing cost. Static UI
fixtures also do not test camera capture. POCO X6 Chrome timing and full-wall
coverage still need verification on the physical device.
