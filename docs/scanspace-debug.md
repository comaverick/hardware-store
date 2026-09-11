# Replaying a ScanSpace depth failure

During a scan, use **Download scan diagnostics** in device diagnostics, or use
the same action after a successful room review. No debug URL is required. This is a local, in-memory snapshot;
it is not uploaded. Leaving the review clears it. Camera photos are excluded.

The export is captured before reconstruction transfers the typed arrays to the
worker. Version 4 contains view-aligned depth grids, projection/pose matrices,
native depth-buffer dimensions and UV mapping (for diagnosis only), point
colors, browser/build metadata, original sample counts, and reconstruction
diagnostics. Camera photos are omitted to bound memory. The snapshot is kept
only for this scan review; leaving the review clears it.

From the customer directory:

```powershell
node scripts/replay-scanspace.mjs "C:\path\to\scanspace-debug.json"
```

The command reads the capture and prints diagnostics and mesh bounds to stdout.
It does not modify the capture or project. Pass `-` to read JSON from stdin.
Version 1 depth exports are also accepted.

Check `coordinateMode`, `inputDepthSamples`, `filteredDepthSamples`,
`roundTrip`, `alignment.pairs`, `alignment.rejectedFrameIds`, `cellRejections`,
`wallStructure`, `rectangularRoomModelCompatible`, and the triangle counts
before and after cleanup. Pair errors are in metres. Automatic pose mutation is
disabled; incompatible frames are still rejected. `algorithmVersion: 21`
uses continuous inverse-depth sampling on supported surfaces. `frameSamples`
reports input, retained measured, and repaired sample counts for every prepared
frame. This distinguishes sensor gaps from filter and frame-selection losses.

Algorithm 10 requires at least 4 cm of camera translation before two samples
can count as independent support for the same fused voxel. Turning in place can
capture another direction, but it cannot reinforce a bowed depth surface.

Algorithm 21 has no single-view or registered-composite fallback. Room captures below
75% heading coverage, captures without overlapping translated viewpoints, and
full-room surfaces with fragmented, curled, or contradictory wall layers return
no mesh. The scanner remains open and reports what must be rescanned. Only a
multi-view measured surface and a closed four-wall depth boundary may proceed
to room review; missing room walls are never synthesized. The separate surface
completion mode may skip the room heading and closed-footprint requirements,
but it still uses the same validated multi-view fusion and never substitutes a
single frame. Surface completion accepts one or more significant wall
directions and validates every detected wall independently for a consistent
depth layer and adequate measured coverage across a 2D wall grid. It uses a
finer fusion volume and does not require a complete room footprint. For partial
surface completion, room-shape, fragmentation, missing-depth, and possible
duplicate-layer findings are review warnings instead of terminal failures when
a meaningful multi-view measured mesh exists. The user may review that mesh or
continue scanning. Empty, tiny, non-overlapping, or unreconstructable captures
remain blocked.
Nearby parallel geometry is classified as a tracking duplicate only when it
overlaps a substantial portion of the measured wall grid. Local shelf and
furniture fronts remain valid foreground geometry. When a duplicate is found,
frames that do not support the consensus wall positions are pruned and fusion
is retried once; `autoLayerRepair` records the decision and frame scores.
Large gaps no longer invalidate an otherwise structurally sound partial
surface. `measuredGapWarning` records wall-grid coverage and the internal
missing ratio so the UI can offer either continued scanning or an explicit
measured-gaps result. No triangles are created for those gaps.

If a mobile browser terminates the high-quality fusion worker under memory
pressure, measured-surface completion retries once with a bounded 520,000-cell
grid and at most 28 evenly selected keyframes. Diagnostics record
`reconstructionProfile: "mobile-safe-retry"` and `workerRecovery`. Automatic
layer repair also releases its first dense volume before rebuilding. These
memory safeguards reduce resolution only; they never create replacement walls.

Algorithm 20 straightens existing vertices only inside robustly measured wall
sectors. It does not add vertices or bridge missing regions. Boundary-aware,
normal-aware smoothing avoids rounding corners and depth discontinuities. Color
snapshots use a 512-pixel long edge and are bounded to an evenly distributed
set; texture selection favors sharp, low-motion, depth-consistent camera views.
Diagnostics report `stabilizedVertices` and the scanner reports
`textureKeyframes`.

Algorithm 21 applies a second, tighter depth-agreement graph to partial-surface
keyframes. It uses the stricter component only when at least three frames and
40% of the generally aligned capture remain, avoiding a new completion blocker.
Texture visibility now uses a smaller depth neighborhood and a 3%/5.5 cm
agreement limit. Atlas tiles receive bounded exposure and white-balance
normalization, and four coherence passes reduce per-triangle camera seams.
Diagnostics expose `alignment.surfaceConsistency` and
`photometricNormalization`.

Capture requires a genuinely new camera viewpoint for every retained keyframe.
Waiting at one pose cannot add duplicate support to a warped depth observation.
The live preview draws filtered measurements only from retained keyframes.
Repeated transient frames cannot mark an area as saved. The overlap fraction
includes missing pixels in its denominator and is not a guarantee of final mesh
coverage. Spatial voxel compaction does not create repeat-observation evidence.

Version 3 captures that contain transformed `depthUvs` are marked ambiguous and
are not silently reinterpreted by the new algorithm. Replay reports that a fresh
version 4 capture is required. Older captures without those transformed UVs can
still be inspected using their legacy view-aligned geometry.

Replay uses the actual production fusion module. Geometry can be compared;
texture coverage cannot be reproduced without the omitted camera photos.
Occlusion alone never proves a deeper observation false. Only confidently
measured empty space in front of a surface can vote against old geometry.
Consistent wrong sensor readings remain possible and require examining the
capture, not adjusting a distance threshold based on screenshots.
