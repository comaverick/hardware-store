# ScanSpace result repair

Prepared October 2, 2026. Implementation baseline: `cfa8e18`.

## Scope and evidence

Keep the working scanner, capture acceptance rules, controls and result viewer unchanged. Repair the finished mesh in the shared reconstruction path before photograph projection. Preserve the original capture, measured openings, real wall angles and object relief. Missing observations do not justify generating a complete room.

The user confirmed that `cdx-scanspace-scan-2026-10-02T12-27-04-413Z.json` is the scan in the two supplied screenshots. It contains 60 depth views; 58 were fused. Joint pose refinement already improved the held-out residual from 4.64 cm to 3.40 cm. Larger pose limits are therefore not the first repair.

The capture detects a wall plane supported by 14 frame IDs, but measured wall seeds are excluded from planar consolidation. Flattening raw wall depth before relief protection would also erase evidence of curtains, shelves and trim, so wall repair should primarily use bounded mesh consolidation and original observations.

The existing structural replacement was rejected because disconnected area increased from 0.073 m² to 0.366 m². A separate synthetic reproduction shows the seam defect: rebuilding a floor 2 cm above its consensus plane detaches its retained baseboard. Grid vertices are on the plane while retained clipping vertices stay at their previous height. Numerical topology welding cannot join that physical gap. The rollback is correct and must remain enabled.

Most final area belongs to one connected mesh. Removing only tiny islands does not address attached flares and spikes.

## Implementation sequence

1. **Repair structural replacement seams.** Transfer supported, bounded boundary corrections to all incident retained faces before clipping, or retain the boundary when evidence is insufficient. Use shared coordinates and conforming topology. Test offset baseboards, partial perimeter triangles and floor/wall junctions. Keep all existing rollback thresholds.
2. **Use supported wall planes.** Seed mesh consolidation from independently measured wall footprints with bounded displacement and original-depth relief protection. Require translated observations at the local patch, protect separate parallel faces, and retain true plane angles. Enable wall grid replacement only when its ownership and seam handling meet the same conditions.
3. **Prune contradicted attached artifacts.** Remove a triangle only when all corners and its interior lack measured agreement and several translated, continuous depth observations see free space through it. Foreground occlusion and missing depth remain unknown. Any measured support preserves the face. Cache evidence and bound reconstruction cost.
4. **Integrate before textures.** Run these repairs only in surface reconstruction. Use the same production fusion path for live completion and imported raw captures. Recompute topology, winding, area and photograph projection after geometry settles; do not move already textured vertices in the viewer.
5. **Validate and record limits.** Add focused regressions for each established failure, replay the exact confirmed capture before and after, run ScanSpace tests and the production build. Verify unsupported geometry removal without losing observed detail or adding surfaces across unobserved gaps.

## Acceptance criteria

- Scanning and viewer source files have no changes.
- The noisy floor/baseboard fixture remains connected after replacement and passes the existing structural regression guard.
- Supported wall layers consolidate without flattening measured folds, furniture or distinct parallel surfaces.
- Artifact pruning requires independent free-space contradictions; sparse observations, occlusion and a single agreeing view preserve geometry.
- The exact capture still reconstructs with retained coverage; topology and texture diagnostics are compared to the baseline. Any remaining failed repair is reported rather than hidden by weakening guards.
- Original capture files remain byte-for-byte unchanged.

## Implementation and verification results

Implemented in the reconstruction modules only. Raw wall planes now seed bounded, relief-aware consolidation; original wall depth remains unchanged. Supported floor replacement shares corrected boundaries and retains measured attachment collars where a new grid cannot reproduce an old edge. A conservative original-depth pass can trim contradicted attached triangles after gap repair. Photographs continue to project onto the final repaired geometry. Algorithm diagnostics are version 46.

The existing topology rollback thresholds remain unchanged. Wall grid rebuilding stays disabled: the supported wall consolidation fixes layers without replacing curtains, pictures or openings. The scanner, adaptive capture, shared completion options, result UI and topology-guard implementation have no edits.

The exact capture was replayed from `cfa8e18` and from the final working tree using `scripts/inspect-scanspace-result.cjs`. The raw capture SHA-256 remains `20ee96ba29c73849433971e3987c685928831592acd43dc5d30ccab0dd44b723`.

| Recorded result | Baseline | Repaired |
| --- | ---: | ---: |
| Fused views | 58 | 58 |
| Structural replacement accepted | No | Yes |
| Rebuilt supported floor | 0 m² (rolled back) | 1.9584 m² |
| Measured wall footprint using the raw plane | Excluded | 1.8807 m² |
| Non-manifold edges | 2,960 | 2,786 |
| Winding conflicts | 3,144 | 2,509 |
| Disconnected area | 0.0606 m² | 0.1098 m² |
| Texture coverage | 81% | 81% |

The replacement preserves 59 measured boundary cells (0.8496 m²) and 403 original attachment edges. Disconnected area still increases by roughly 0.0492 m² in the final output; this is within the unchanged regression allowance, but the result is not a completely joined or closed room. Some loose measured fragments remain. The candidate guard accepts the repaired floor, and no large displacement or threshold relaxation was used to obtain acceptance.

The new boundary stage was profiled on the recorded checkpoint: exact shared-edge lookup and a fast path for unchanged planar seams reduced its runtime from 45.5 seconds to 3.40 seconds while retaining the same attachment cells and floor footprint. The final full replay completed in 86.4 seconds on this host. These timings are not phone completion estimates.

Validation covers the 421 current ScanSpace cases through the broad run and final reruns of changed suites. The broad run passed 418 cases and exposed the new curled-attachment regression while it was being implemented; the final structural surface, topology, rollback and evidence run passes all 40 cases, including that regression and two added cases. The 70-case fusion suite, wall/depth suites, scanner lifecycle and UI suites pass. The production build compiles with CI checks, and its source maps match all five final production modules. `git diff --check` passes.

Remaining upper distortions cannot safely be erased solely because they look irregular. A read-only sample of 810 upper triangle centers found original-depth support for all of them under the existing neighbourhood check; 333 also had at least three translated views agreeing at the central pixel. None of the points with three clear free-space contradictions had at most one independent agreeing view. The pruning pass therefore removes no triangles from this particular capture. Some upper measurements differ from the structural plane by tens of centimeters, beyond the bounded repair. Their source pixels need separate patch-level analysis before further correction; this implementation does not demonstrate a completely flush upper surface.

The desktop replay validates this recorded capture. Device completion time and new scans still need checking on the phone. Reload the updated app and re-import the original raw JSON to reconstruct this capture with the repair; already stored mesh geometry is not automatically rewritten.

## Follow-up after the visual comparison, October 3

The user’s before/after comparison confirms that version 46 did not achieve the visible goal. Its topology and wall/floor improvements were too small to straighten the upper sheets. A direct source-photo comparison finds adjacent near-horizontal and steep depth fits on the same continuous gray outer ceiling, rather than a real ceiling step at the split. The inset ceiling, black trim, recessed light, curtains and furniture are real and must remain separate.

Two evidence bugs are repaired: camera selection now finds an available set of three mutually translated viewpoints instead of depending on capture order; horizontal footprint statistics use those independent views rather than including stationary duplicates. The detector’s 0.35 m² partial-ceiling requirement is also carried through consolidation and replacement. Original baseline, angle and generic five-centimetre correction limits remain unchanged.

The next experiment uses the original photographs to bound a continuous ceiling region, then checks disagreement across independent depth views. Larger correction is limited to this region and happens along each original camera ray before fusion and photo projection. Dark trim, lights, sharp edges, stable separate heights, missing rays and regions without independent evidence remain protected. This is a model-based ceiling repair, not a more permissive live scanner check. The experiment must show a visible improvement on the actual capture before being enabled in production; area counters alone are insufficient.

The first trial shifted 23,247 samples but left the tallest known sheets outside its 65 cm ray bound. Its visual comparison remained unsatisfactory, so that candidate was not enabled. Source-photo mapping identified two points on the same gray ceiling requiring 67.9 and 69.8 cm ray corrections. The second trial uses a 72 cm bound within the verified region, with at least two translated photo masks and three translated depth observers. Stable alternate offsets, narrow white trim visible only in the high-resolution image, and dark fixtures are protected. It retains the original arrays, marks corrected rays, and reduces their confidence; those rays cannot claim measured free space.

Replacement now recognizes the specifically tagged repaired ceiling rays. Previously, the unchanged biased original depth could reject the repaired plane at the next stage. Other rays still use their original observations, and free-space vetoes require a reliable ray. Recovered footprint cells contain existing observations from three independent cameras; missing pixels are not converted into measurements.

The second trial visibly removes the large bent upper sheet in the same-angle mesh comparison. It corrects 28,013 samples in 1.512 m² of disputed ceiling cells; the largest displacement is 71.99 cm along the source ray (61.66 cm vertically). It is a structural approximation supported by photographs, not proof of centimetre-accurate ceiling dimensions. Eight perspective regressions cover fixtures, dark and thin white trim, higher ceiling levels, stable offsets, repeated stationary photos, missing depth and immutable inputs with unchanged source-pixel correspondence.

The trial retains all 58 fused views and 82% texture coverage (previously 81%). Some trim and object geometry remains rough. Topology also remains imperfect: disconnected area is 0.1821 m² versus version 46's 0.1098 m², and winding conflicts rise from 2,509 to 3,342. The result is not a closed fabrication mesh. These tradeoffs and remaining limitations must accompany the visible improvement; the reconstruction guard thresholds are unchanged.

## Final production replay, October 3

The photographed ceiling repair is now integrated into surface reconstruction before generic depth regularization, fusion and texturing. Algorithm diagnostics are version 47. Room mode and captures without a supported ceiling do not use this repair. The implementation keeps the 72 cm ceiling-specific ray limit separate from the unchanged generic five-centimetre structural limit.

The actual production path initially reproduced the trial exactly. Final review also found that duplicate stationary free-space observations could veto a rebuilt cell more than once. Both agreement and contradiction now count independent camera viewpoints; a regression confirms that a duplicate veto cannot suppress a repair while a second translated veto still can.

The final production replay completed in 40.2 seconds on this desktop and produced 132,598 triangles, 28,013 corrected ceiling samples, 1.512 m² of disputed cells and 82% texture coverage. Supported grid replacement covers 1.9728 m² of floor and 0.5328 m² of ceiling; the larger repaired footprint also contributes to fusion and bounded consolidation. Original-depth evidence prunes 36 small contradicted faces (0.00308 m²). The final same-angle comparison against version 46 visibly reduces the large bent upper sheet, while preserving the remaining measured room and objects. This does not establish phone completion time or a fully flush, joined room. Final topology remains imperfect: 2,835 non-manifold edges, 3,343 winding conflicts and 0.1821 m² of disconnected area.

Final regression checks pass 83 cases across ceiling recovery, structural depth, planar consolidation, structural surfaces and evidence pruning, plus 13 topology/rollback cases and eight selected production-fusion cases (104 cases). The shared completion case passes again after the independent-veto fix. The fusion checks cover shared import/completion settings, independent texture observations, depth versus color projection, observed openings, furniture occlusion, room coverage and stationary-camera support. The previous 70-case fusion run remains recorded above; the final selective run does not claim to rerun all 70 cases. The CI production build compiles successfully, and its source maps match all seven final production repair modules. The original capture hash is unchanged. No scanner, adaptive capture, completion settings, viewer or rollback-threshold source has changed.

Reload the updated application and import the original raw JSON again to rebuild it with version 47. A previously stored mesh does not automatically reconstruct itself. The larger ceiling correction infers a planar surface where translated depth views disagree; use the original measurements when assessing precise ceiling dimensions.

## Automatic colored gap repair, October 3

The user accepted the remaining wall/ceiling distortion for now and requested automatic filling of small missing regions using surrounding colors. This follow-up changes finished reconstruction and portable exports only. The scanner, room designer and result controls are unchanged. Implementation baseline is `9196266`; algorithm diagnostics are now version 48.

The existing small-hole caps were always rendered neutral gray, even when the surrounding surface had a valid photograph. Connected estimated patches now take linear colors from their own coplanar, photographed rim. The observed boundary stays fixed while harmonic interpolation blends the interior. No original photograph is projected onto a missing ray, and no pattern, text, fixture or object is generated. Unrelated neighboring folds cannot supply color. Regions without enough observed rim colors retain the neutral appearance.

A new missing-depth estimate is limited to a closed, nearly planar hole at most 30 cm across. It needs matching photographs from at least two translated color-camera poses and existing measured support at the photographed rim. Refreshed copies of one photograph cannot borrow independence from older depth poses. Foreground objects, reliable background/free-space observations, contrasting interiors, outer capture boundaries and larger unobserved gaps prevent this estimate. The pre-existing, directly depth-supported repair keeps its original larger bounds. Estimated faces retain their markers in saved meshes, including the distinction for color-supported geometry; exports without an atlas preserve the linear color multiplier instead of replacing repaired colors with the white fallback tile.

The confirmed raw scan replays in 36.5 seconds on this desktop, retaining all 58 fused views and 82% measured-photo coverage. It has 576 retained estimated triangles across the existing repairs. Fourteen connected patches (271 triangles, 0.08403 m²) now blend with their observed surroundings. None of the remaining gaps meets the new missing-depth criteria, so this particular capture gains no additional geometry. Its positions, indices, normals, UVs and original atlas are byte-identical to version 47; only the repair colors and diagnostics change. Connectivity consequently remains unchanged. The floor close-up comparison shows the color change without claiming that all visible black gaps are closed.

Validation passes 60 focused geometry/color/export/topology cases and eight selected production-fusion cases (68 total), plus the CI production build. The build's source maps match all four changed production modules. The original capture hash is unchanged, and `git diff --check` passes. Re-import the original raw JSON in the updated application to obtain these colors; an already stored mesh does not reconstruct itself. Fine tile or wood patterns in an inferred patch remain approximate.

## Ceiling layer cleanup, October 4

The user requested a fix for the remaining stacked, distorted ceiling sheets. This follow-up changes reconstruction before camera texturing, with algorithm version 55. Capture acceptance, scanner controls, viewer controls, wall placement and finish shaders are unchanged.

The photographed ceiling region previously ended at steep depth curls, and mesh replacement only accepted already near-horizontal faces within five centimeters of the plane. Consequently, distorted copies survived beside the small flat replacement. Reconstruction now carries the photographed region and original depth-normal evidence into the mesh stage. The region may extend through the same photographed material only along existing measured rays into an independently supported footprint; this extension changes no source depths.

A supported ceiling uses a shared four-centimeter grid. Each coarse footprint still requires three translated native depth observers; photographs cannot supply a missing depth vote. Fine interior cells require two translated depth observers and two translated photograph owners at their center and inset corners. Missing-cell repairs retain the three-view requirement and free-space veto. Actual color-camera poses determine photograph independence. Full-resolution photographs protect narrow trim and fixtures when available.

Bent portions are clipped only where both their original and projected positions belong to that ceiling. A vertical face additionally needs horizontal original-depth evidence along its camera rays; matching paint alone cannot authorize removing a real riser. Stable alternate ceiling heights remain protected. Retained risers and partially owned faces preserve their actual shared attachment collar, while a partially owned triangle cannot protect its own internal diagonal. Shared-boundary movement remains capped at five centimeters, and the existing topology rollback thresholds are unchanged. The larger ceiling-specific ownership bound remains 72 centimeters.

The confirmed raw capture was replayed through production fusion. All 58 fused depth views and 12 photographs remain available. Bent portions of 693 source ceiling triangles are replaced, and the supported ceiling grid covers 0.8336 m², compared with 0.5328 m² previously. The floor footprint remains 1.9728 m². Prepared wall area remains 4.6784 m², with the existing 25.63 mm setback. The full result has 139,239 triangles and 83% photograph coverage, compared with 132,598 triangles and 82% previously. The unchanged structural guard accepts the candidate; final disconnected area is 0.1485 m² versus 0.1821 m² previously. This does not establish a closed or fully accurate room mesh.

Desktop visual checks compare the same upward Walk inside angle in Geometry and Photo views. The lower ceiling region has fewer overlapping remnants while the recessed light, dark trim and measured upper section remain visible. Rough outer boundaries, missing regions and uncertain upper folds still remain; the implementation does not demonstrate a completely flush ceiling across every captured region. They are not covered by a uniform-color plane or an invented complete ceiling.

Fine ceiling edges made the previous 12 cm seam lookup unnecessarily expensive. Camera-set baseline results are now cached, and the ceiling boundary lookup uses 4 cm buckets without changing exact overlap tests or correction tolerances. On the recorded reconstruction checkpoint, the finer lookup reduces the reconstruction stage from 95.3 to 30.8 seconds on this desktop. Positions, indices, colors, patch IDs and estimate markers after topology conformance are byte-identical to the slower candidate. These are desktop checkpoint timings, not phone completion estimates.

Regression checks cover photographed duplicates, vertical distortion, same-painted real risers, sparse native pixels, photo boundaries, stable alternate levels, stationary photographs, independent color poses, missing third depth votes and immutable capture arrays. Existing floor/baseboard, topology, rollback, wall preparation, import/export and review checks also run. The original capture SHA-256 remains `20ee96ba29c73849433971e3987c685928831592acd43dc5d30ccab0dd44b723`. Reload the updated app and import the original raw JSON to obtain version 55; a portable mesh without its raw observations cannot rerun reconstruction.

Final validation passes 127 distinct focused and selected production-fusion cases. The final structural surface, topology and rollback rerun passes all 44 cases after the lookup optimization. The CI production build compiles successfully, and its source maps match the four final production modules. `git diff --check` passes. The original raw capture is also imported through the app's worker path for the final viewer check.

The app's final worker import reports version 55, 58 depth views, 12 photographs, 139,227 triangles and 83% color coverage. Photo, Geometry, upward Walk inside and a rotated side view were checked; the remaining upper folds are visible and are not reported as fully repaired. A private checkpoint experiment permitting two-view cells immediately beside a three-view footprint added only one 4 cm cell (0.0016 m²) and replaced no additional bent faces. That relaxation is not included in production. More overlapping ceiling observations, including the trim and wall junction, are needed to resolve the remaining uncertain shape without simply covering it with an inferred plane.
