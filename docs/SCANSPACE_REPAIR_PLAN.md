# ScanSpace repair plan for Sol High

Status: approved and implemented locally. Synthetic and build verification is
recorded in the task handoff; phone verification still requires a fresh version
4 capture from the user's device.

## Objective and workspace

Repair the coordinate and reconstruction defects that can produce torn, missing, or distorted room surfaces. Demonstrate the changes against known geometry and, when available, the user's actual captures. A successful fallback or a passing build alone does not establish that room scanning is fixed.

Actual repository: `C:\Users\maver\OneDrive\Documents\hardware-store\hardware-store`.

Customer application: `C:\Users\maver\OneDrive\Documents\hardware-store\hardware-store\customer`.

The active task's original `Documents\ChatGPT\hardware-store` folder is empty and is not the application repository. Last inspected HEAD: `634bc73`, following `7b13131`. Recheck HEAD, instructions, and working changes before implementation; preserve unrelated user work. Do not reset to an earlier commit.

The previous implementation reported 41 passing customer tests and a successful build. Those tests did not cover the demonstrated coordinate inconsistency. Rerun the relevant baseline when implementation starts; do not treat the prior counts as current validation.

## Evidence and uncertainty

The earlier screenshots show incomplete textured surface patches. A later image looks more connected but remains incomplete. The latest two attempts were mentioned without attached images or diagnostic files. Do not claim to have inspected them.

Tracking drift, device depth errors, insufficient translation, and occlusion are possible contributors. None has been established as the cause of the actual phone captures. Earlier messages incorrectly elevated tracking drift from a hypothesis to a conclusion. Do not carry that assumption into the implementation.

### Confirmed implementation defects and gaps

1. **Unprojection and projection use inconsistent sample coordinates.** `depth.js` conditionally transforms sample UVs using `normDepthBufferFromNormView` and stores transformed `depthU/depthV`. `fusion.js:depthPosition` uses those transformed coordinates, but `projectWorld` followed by `gridIndex` indexes a grid still arranged by the original `gridX/gridY`. No corresponding inverse coordinate mapping is applied. This affects integration, frame comparisons, and registration when the mapping is nonidentity.
2. **Texture visibility mixes depth reference frames.** `texturedMesh` projects with `projectColorWorld`, then compares that camera-space depth with `filteredDepth` associated with the depth geometry. Separate camera and depth geometry require separate projections and depths for visibility and texture sampling.
3. **Pose refinement has insufficient validation.** `refineFramePoses` estimates one correction against one selected earlier frame. Its acceptance score uses the fitted correspondences. It neither validates independent correspondences across multiple views nor reruns the overlap graph after correction. It is not global loop closure.
4. **Different reconstruction consumers use different observations.** Fusion may correct or reject keyframes. `ScannerPanel.finish` still sends `raw.points` from the original voxel cloud to structural reconstruction and builds the point preview from it. Correcting the mesh alone does not correct room boundaries or the fallback cloud.
5. **Readiness claims more than it measures.** Six stored keyframes are called six overlapping views, although the live check does not establish depth overlap. Directional sweep measures heading coverage, not room surface completeness.
6. **The wall-direction heuristic cannot establish physical distortion.** A curved real wall, furniture, or a nonrectangular room can fail a Manhattan-direction test while being measured correctly. Its failure message currently attributes the result to tracking drift without proving that cause.

### Reproduced failure to preserve as a regression

A read-only probe of the production functions used a 4 x 4 grid with a 90-degree UV mapping:

```text
stored depth U = 1 - original V
stored depth V = original U
identity pose; perspective projection with p00 = p11 = 1; depth = 2 metres
original sample index = 4
depthPosition -> world point (0.5, 1.5, -2)
projectWorld -> UV (0.625, 0.125), depth 2
gridIndex -> sample index 2
```

The sample fails to return to its original pixel. This proves an internal inconsistency for that mapping, not that the phone necessarily used it. The new regression must exercise production functions and an independently defined rotated depth-buffer fixture.

## Phase 1: preserve evidence and establish the baseline

1. Record the repository commit and working diff. Identify any AGENTS instructions relevant to the source tree.
2. If the two scan diagnostic JSON files are available, replay both with `customer/scripts/replay-scanspace.mjs`. Preserve the original files locally and keep room captures out of commits.
3. Record input/prepared/selected keyframes, invalid depth counts, sample bounds, alignment residuals, corrections, cell rejection counts, triangles before and after cleanup, component areas, fallback mode, and final bounds. Identify the algorithm version recorded by the capture rather than assuming the deployed app matches HEAD.
4. Extend replay, if needed, to compare baseline and proposed configurations with correction disabled/enabled and smoothing disabled/enabled. Each run must start from freshly restored inputs so mutation cannot contaminate comparisons.
5. Inspect intermediate geometry in a consistent camera view: sampled single frame, combined frames before refinement, after refinement, extracted surface before cleanup, and final result. Use geometry-only rendering to separate texture defects from geometry defects.
6. If real captures are unavailable, proceed with the demonstrated code bugs and synthetic reproductions. Report device verification as pending rather than declaring the user's failures fixed.

Deliverable: a baseline summary that distinguishes reproduced bugs from capture-specific hypotheses.

## Phase 2: define and implement one coordinate contract

Primary files: `core/depth.js`, `xr/RoomScanner.js`, `core/fusion.js`; optionally a small shared `core/captureGeometry.js` module.

Consult the current WebXR depth specification and the runtime behavior exposed by this capture. `getDepthInMeters(u, v)` already transforms normalized view coordinates to depth-buffer coordinates to read the measurement. Depth-buffer storage orientation must not automatically be interpreted as a camera-ray rotation. `matchDepthView: true` requests aligned depth, but newly documented attributes are not proof of implementation support on this browser. Reference: https://immersive-web.github.io/depth-sensing/ .

Prefer a **view-aligned canonical grid** for the existing accessor-based capture path:

- Grid indices identify normalized view pixel centres.
- Sample depth through `getDepthInMeters` at those centres.
- Use projection and pose consistent with the frame in which those depths are defined.
- Keep native-buffer rotation/crop handling inside depth lookup; do not apply it again to view rays.
- Project world points back into that same canonical grid when comparing them to stored depths.

If a verified runtime exposes genuinely different depth geometry, handle it with an explicit adapter and documented reprojection. A native-depth grid is another valid representation, but requires its own consistent sampling, projection, lookup, and color projection. Never independently substitute one matrix because an optional property happens to exist. Unsupported or ambiguous geometry must produce a diagnostic limitation, not silently mixed matrices.

Implementation requirements:

1. Name matrix directions explicitly, such as world-from-capture and clip-from-capture. State whether UVs describe the canonical sample grid, a native depth buffer, or a color image.
2. Centralize grid-to-world and world-to-grid calculations so capture, filtering, fusion, overlap checks, and fallback share the same rules.
3. Preserve the camera-axis definition of depth. A normalized radial ray multiplied by axis depth is incorrect.
4. Recompute filtered and repaired samples through the same geometry contract. Missing pixels need a valid ray even when no original point was captured.
5. Validate matrices and bounds. Reject invalid projections rather than clamping an off-image sample onto an edge pixel and treating it as valid evidence.
6. Select sample-grid aspect from the canonical view and its supported sampling density, accounting for portrait orientation; avoid blindly treating native depth width/height as view width/height.
7. Keep debug exports explicit about geometry mode, mappings, and actual property availability.

Acceptance: every supported synthetic pixel centre round-trips to its source index and depth. Test identity, 90/180/270-degree native-buffer orientations, crop/scale, rectangular portrait/landscape grids, off-axis projections, and translated/rotated camera poses. A known planar surface must remain planar through capture, filtering, and fusion.

## Phase 3: repair RGB/depth visibility correspondence

Primary files: `core/fusion.js` (`sampleFrameColor`, `texturedMesh`, integration and measured fallback), `xr/cameraColor.js`.

1. Project a world point into the depth representation to select its depth sample and predict depth in the same reference frame. Perform the occlusion/consistency comparison there.
2. Independently project the point into the camera image for color coordinates when the geometries differ.
3. Confirm vertical image orientation at the readback/atlas boundary. Apply the image-row flip exactly where the documented storage convention requires it.
4. Verify all texture paths, including vertex colors and single-frame fallback, rather than fixing only final atlas UVs.
5. Inspect atlas handling when keyframes have different image dimensions, including device orientation changes. Resample into a defined tile layout or explicitly handle different tiles.
6. Keep projection, poses, and sampled images synchronized. Pose refinement must preserve the relative transform between depth and color sensors.

Acceptance: use an asymmetric color grid, off-centre markers, two depth planes, and an occluding foreground object. Colors must stay on the correct surface and remain correctly oriented. A foreground texture must not be accepted for a background triangle merely because a nearby pixel has a similar depth. Test distinct camera/depth geometry only with fixtures consistent with the supported adapter.

## Phase 4: reassess registration after projection is fixed

Primary file: `core/fusion.js` (`validateFrameOverlap`, `alignmentPairs`, `estimateYawCorrection`, `refineFramePoses`).

First compare corrected coordinate handling with pose refinement disabled. If the geometry becomes correct, retain that baseline and avoid adding more registration complexity without evidence.

If refinement is still necessary:

1. Construct correspondences only from measured, visible, mutually compatible samples. Exclude holes, silhouettes, known occlusions, and interpolated data from strong pose evidence.
2. Use spatially distributed samples and explicit degeneracy checks. A single flat wall does not reliably constrain every motion component. Do not convert nearest-pixel quantization into apparent motion correction.
3. Evaluate a proposed correction against independent validation samples and multiple overlapping reference frames, including nonadjacent views when available. If sufficient independent evidence is absent, preserve the original pose.
4. Score improvement using newly projected correspondences as well as inlier coverage. A reduced fitted residual alone is insufficient. Reject corrections that improve one view but materially damage agreement with the others.
5. Bound rotation and actual camera displacement. Compute displacement at the camera origin; the translation part of a world-origin rotation depends on the coordinate origin and is not by itself a safe camera-motion bound.
6. Keep proposals reversible. Update positions, depth poses, camera poses, and associated metadata together only after acceptance. Preserve original input arrays.
7. Revalidate the overlap graph after corrections and record selected/rejected observations explicitly.
8. Bound the number of neighbors, samples, and iterations for phone memory and latency. Do not run unconstrained all-pairs optimization.

Acceptance: known small injected errors reduce error to independent ground truth; already-correct translated views do not collapse together; occluders do not drive pose changes; ambiguous planar cases preserve unconstrained motion. Changing the world-coordinate origin must not change correction acceptance. A return-to-start trajectory must be evaluated for accumulated drift. Call the implementation loop closure only if it actually enforces a global revisit constraint.

The existing test that only checks `poseCorrectionApplied === true` is inadequate. Replace or extend it with geometric accuracy, preservation, and nonmutation assertions.

## Phase 5: use consistent observations throughout reconstruction

Primary files: `components/ScannerPanel.jsx`, `core/fusion.worker.js`, `core/reconstruction.worker.js`, `core/reconstruction.js`, `core/scanCloud.js`.

1. Choose an authoritative set of accepted frames and poses for final geometry. Return a bounded corrected structural point set from the worker, or return enough frame/pose information to rebuild it correctly.
2. Build final structural detection and the final point-cloud fallback from observations in that same world frame. Do not attempt to correct already-averaged voxel points with one global offset.
3. Keep live preview versus final reconstruction semantics clear. The live preview can be provisional; final consumers must agree about rejected observations and corrections.
4. Apply floor offsets exactly once. Ensure observer position, fitted boundaries, textures, mesh, and point cloud use the same floor/world convention.
5. Keep scan data resumable when structural detection fails. Verify that worker transfers do not detach the scanner's live arrays before the user chooses to finish permanently.
6. In the incomplete-result state, retain explicit options to continue scanning, review captured geometry, or cancel. Avoid trapping users in repeated failed completion attempts.

Acceptance: incomplete scan -> continue -> capture additional frames -> finish works without missing buffers or stale diagnostics. Mesh and structural bounds correspond under a synthetic pose correction. Worker failure leaves a usable capture state.

## Phase 6: make quality decisions evidence-based

Primary files: `core/fusion.js`, `core/readiness.js`, `components/PartialScanReview.jsx`, `components/PartialScanScene.jsx`, `components/ScannerPanel.jsx`.

1. Replace causal claims such as 'warped by tracking drift' with the measured reason unless independent evidence identifies that cause.
2. Treat Manhattan alignment as a room-model compatibility metric, not a universal truth test for scanned surfaces. Correct curved surfaces and furniture must not automatically be discarded.
3. Evaluate fragmentation alongside retained observed area and multi-view residuals. Removing enough legitimate geometry to produce a cleaner thumbnail is not an improvement.
4. Preserve the existing rule that occluded space behind an object is unknown; only reliable observed free space may contradict old geometry.
5. Separate capture readiness, geometric consistency, and room closure. Keyframe count is not measured overlap; heading sweep is not observed surface area. Label preliminary counts honestly and keep the structural closure check authoritative.
6. Label a fallback that uses one camera view as a single-view depth preview. Its thin appearance is expected and it must not be presented as the reconstructed whole room.
7. Keep texture coverage visibly separate from completeness; do not introduce an invented room coverage percentage.

Acceptance: valid partial scans remain inspectable, valid curved objects are preserved, disconnected noise is explained, and unsupported room geometry leaves editing unavailable with an accurate reason.

## Phase 7: make diagnostics and replay sufficient to investigate the phone

Primary files: `core/captureDebug.js`, `core/captureDebug.test.js`, `scripts/replay-scanspace.mjs`, `docs/scanspace-debug.md`.

- Version the geometry schema and algorithm separately. Export the actual build identifier, browser string, capture timing, native/sample dimensions, orientation, runtime depth mode, native UV mapping, and explicit chosen coordinate mode where available. Store values before frame-scoped objects expire.
- Report round-trip errors, invalid-sample counts, alignment residuals before/after, reasons for rejection, observed-area retention, and stage timings. Distinguish disabled, unavailable, proposed, and accepted refinement.
- Read existing v1-v3 exports using their documented semantics. Do not silently reinterpret old malformed coordinates as a clean new capture. Flag ambiguity and report when a fresh capture is necessary.
- Validate array lengths, finite matrices, dimensions, supported versions, and memory bounds before reconstruction. Retain the current limit on keyframes and a bounded allocation policy.
- Keep real camera images omitted by default. Use synthetic image fixtures for texture tests; any real color-image export needs an explicit opt-in workflow.
- If common geometry code is extracted, update replay's module loading. Its current data-URL imports cannot resolve newly added relative imports automatically. Keep the production and replay math shared and test the actual CLI.

Acceptance: export -> restore -> production fusion preserves deterministic geometry; replay mode comparisons do not mutate input; malformed/ambiguous captures report useful errors without excessive allocation.

## Phase 8: validation and completion criteria

Run focused regressions after each coherent change. At the integration checkpoint, run the customer suite and production build from the customer directory:

```powershell
$env:CI = 'true'
npm test -- --watchAll=false --runInBand
npm run build
```

Run `git diff --check` and inspect the final diff. Validate the actual replay CLI, not only imported functions.

Required validation matrix:

| Case | Required evidence |
| --- | --- |
| Rotated/cropped native depth buffer | Sample centres round-trip correctly in the canonical representation |
| Planar wall at several poses | Known plane location and normal preserved before and after fusion |
| Asymmetric camera image | Orientation and surface color registration correct |
| Missing depth and furniture occlusion | No invented bridges; measured background remains where independently observed |
| Correct camera trajectory | Refinement preserves it and does not manufacture parallax |
| Small injected pose error | Independent geometric error improves within bounded corrections |
| Ambiguous or incompatible views | Correction is refused or observations are excluded with measured reasons |
| Genuine curved/nonrectangular surfaces | Geometry is retained; room-model limitations are separate |
| Finish/resume and worker failure | No detached live buffers, stale diagnostics, or mismatched final geometry |
| Real failing captures, if supplied | Repeatable before/after metrics and matched-view visual comparison |

For the device check, use a well-lit flat wall with identifiable details and an unobstructed floor, then an overlapping sideways pass, an adjoining corner, and finally the cluttered room. Include a measured distance as a scale check. Compare repeated scans and recorded diagnostics. Ask for user-assisted device capture when hardware access is unavailable; do not fabricate a phone test.

Choose numeric accuracy targets before comparing candidate outputs. Synthetic exact-geometry targets should be tight enough to detect wrong-pixel lookup; sensor-error targets must be based on available measurements, not inferred from screenshots. Measure runtime and peak allocations on bounded fixtures and the phone if available.

Completion must state separately: code verified, replay verified, device verified, and deployed. A local build is not deployment, and passing synthetic tests is not proof that the user's phone issue is resolved. User scan data should remain local unless separately authorized. Do not push or deploy merely because the implementation plan was approved.

## Suggested implementation sequence and handoff

Keep changes reviewable in this order:

1. Baseline evidence and failing coordinate/visibility regressions.
2. Canonical geometry, sampling, projection, and serialization fixes.
3. Texture visibility and image-orientation fixes.
4. Registration reassessment, then only justified refinement changes.
5. Consistent final observations and resumable capture flow.
6. Honest quality/fallback reporting and integrated verification.

Do not start by tuning voxel sizes, hole-fill limits, fragment thresholds, or synthetic wall fitting. Those settings can hide symptoms while the wrong samples are still compared. Do not make full global loop closure a prerequisite unless evidence after the coordinate fix demonstrates it is necessary.

Final implementation handoff should include the confirmed cause and evidence, files changed, geometric test outcomes, any remaining device uncertainty, actual deployment status, and the shortest useful next phone test.
