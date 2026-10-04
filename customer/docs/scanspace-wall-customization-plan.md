# ScanSpace continuous walls for room customization

Prepared October 3, 2026. The investigation and plan below describe the original problem. The implementation records describe the successive changes, including the failed v50/v51 seam repairs and their v52 correction.

## Finding

The editable wall is fragmented, but disconnected scan islands are only part of the problem. The current finish implementation recolors selected scan triangles. It keeps their uneven positions, holes, competing depth layers and normals. A smooth paint material cannot turn that geometry into a smooth wall.

The recommended fix is a separate, flat wall surface for customization, built after capture from supported wall boundaries. It should replace the corresponding rough wall faces in the design view while retaining captured furniture, artwork and real openings. Original scan geometry and measurements remain available through the existing inspection views. Capture acceptance and scanning controls do not need to become stricter.

## Evidence

I inspected the current result in Photo and Geometry at the same walk-view camera position. The fragmentation exists in Geometry before a finish is applied. I also analyzed the saved production replay of the user-confirmed `cdx-scanspace-scan-2026-10-02T12-27-04-413Z.json` with the current finish classifier. This replay has 132,598 triangles; the current browser result has 132,586. The numbers below describe that saved replay, rather than a new reconstruction of the browser's exact mesh.

Connectivity was computed from coincident geometric edges with a 0.00001 m numerical tolerance. Atlas vertices are intentionally duplicated for texture seams; counting raw vertex indices would incorrectly label every photographed triangle disconnected.

| Observation | Result | Meaning |
| --- | ---: | --- |
| Overall area in the largest connected component | 99.12% | Removing loose islands alone will not straighten the walls. A connected mesh can still be folded, overlapping or full of gaps. |
| Detached components outside the largest component | 138, totaling 0.182 m² | These exist, but represent less than 1% of total triangle area. |
| Wall candidate components before photo protection | 671 | Triangle-by-triangle wall targeting already splits the wall region. These are components of a selected subset, not 671 separate room walls. |
| Components receiving wall paint after photo protection | 391 | Paint is applied to scattered patches rather than a continuous wall surface. |
| Candidate wall triangle area before / after photo protection | 4.983 / 2.029 m² | The mask excludes 59.3% of candidate triangle area. Some exclusions protect real objects; coarse masks can also retain surrounding ordinary wall pixels. Triangle area includes overlapping sheets and is not a room measurement. |
| Painted-face distance from the fitted wall plane, area-weighted 95th percentile | 14.0 cm | Faces receiving paint are still substantially uneven. The classifier permits textured wall vertices within a 16 cm band. |
| Candidate-face normal angle from the wall plane, area-weighted 95th percentile | 46.9° | Irregular orientations remain visible under the finish material's lighting. Real shallow objects can also contribute to this candidate set. |
| Projected wall grid samples with layers separated by more than 1.5 cm | Approximately 11.5% | Some footprints contain several sheets. This is a 4 cm sampling diagnostic, not proof that every layer is erroneous; shallow objects must be separated before replacement. |

The scan has one tagged wall plane supported by 14 frame IDs, with a reported 3.5424 m² supported footprint. The additional side-facing consolidated sheet is untagged; it must not automatically become a wall because it may include curtains or other objects.

### Relevant code

- [scanFinishRendering.js](<C:/Users/maver/OneDrive/Documents/hardware-store/hardware-store/customer/src/features/scanspace/core/scanFinishRendering.js:4>) shares the original geometry attributes and rearranges indices into material groups. It does not flatten, fill or connect surfaces.
- [scanSurfaces.js](<C:/Users/maver/OneDrive/Documents/hardware-store/hardware-store/customer/src/features/scanspace/core/scanSurfaces.js:97>) protects photo details using 10 cm cells and expanded rectangular regions. This protects artwork but can leave blocks of ordinary wall unpainted. Its wall matching also rejects individual faces by angle and distance, creating holes in the selected subset.
- [structuralSurface.js](<C:/Users/maver/OneDrive/Documents/hardware-store/hardware-store/customer/src/features/scanspace/core/structuralSurface.js:97>) explicitly excludes walls from full structural rebuilding. Existing bounded consolidation therefore cannot guarantee a continuous wall sheet.
- [structuralDepth.js](<C:/Users/maver/OneDrive/Documents/hardware-store/hardware-store/customer/src/features/scanspace/core/structuralDepth.js:258>) has useful per-plane cells and relief footprints during reconstruction, but exported diagnostics retain only a relief-cell count. Counts alone cannot identify objects or openings in the viewer.
- [ScanMesh.jsx](<C:/Users/maver/OneDrive/Documents/hardware-store/hardware-store/customer/src/features/scanspace/components/ScanMesh.jsx:54>) applies standard finish lighting to the existing normals and the captured-surface back-face shader. Clean design walls need their own consistent normals and orientation.

Final textured faces are intentionally oriented toward their selected photograph in [fusion.js](<C:/Users/maver/OneDrive/Documents/hardware-store/hardware-store/customer/src/features/scanspace/core/fusion.js:4866>). Final winding counts consequently differ from reconstruction-stage diagnostics. They should not be interpreted as additional disconnected geometry or repaired by blindly flipping the entire textured mesh.

## Implementation sequence

### 1. Carry wall evidence into a derived design model

Add an optional, versioned wall-design model at the reconstruction worker's output. Each wall needs a stable ID, fitted plane, local two-dimensional axes, supported footprint, observed openings, foreground/detail masks, evidence provenance and estimated-region flags. Build it while the structural plane cells and prepared frames are still available; do not try to recover all this information from the final atlas alone.

Reuse independent-view support, relief detection and original depth/free-space projection from the existing structural modules. Classify local footprint regions as supported wall, foreground occlusion, observed opening, bounded repair or unknown. Foreground furniture is not evidence of a doorway; a real opening requires observations through the fitted plane. Preserve genuine wall angles and separate parallel surfaces.

Proposed new module: `core/scanDesignSurfaces.js`, called from the shared fusion pipeline after measured geometry settles and before prepared frame evidence is discarded. Return the optional model through the existing `reconstruction.worker.js` path without rewriting the measured mesh. This runs after capture and is cached. Applying a color or finish must not run reconstruction again or add validation to live scanning. If a particular wall cannot be prepared, retain its captured surface without rejecting or discarding the scan.

### 2. Build one flat mesh per supported wall footprint

Project supported background wall coverage into the plane's local coordinates. Consolidate competing background sheets into one footprint, retain its outer contours and observed openings, then triangulate that footprint with shared boundary coordinates. Use existing grid/contour helpers and installed Three.js triangulation where suitable; a wall with openings needs hole-aware triangulation rather than a single outer polygon cap.

Generate positions on the fitted plane and consistent inward-facing normals. Fit genuine wall/floor and wall/ceiling junctions where both surfaces have evidence, and use shared seam coordinates in the derived design layer. Avoid global axis snapping: actual rooms can contain angled walls.

Prepare a captured-appearance material for the clean wall too: project its new positions into the original source photographs, with source depth/visibility checks, rather than stretching the old triangles' atlas UVs onto a different surface. Bounded estimated gaps can reuse the existing surrounding-color blend. This lets the default room-design result and its painted version share the same continuous geometry; the original measured mesh remains available for inspection.

Fill only enclosed reconstruction gaps within the supported footprint. Start with the existing small, bounded repair policy; a larger internal repair requires surrounding wall evidence and no independent see-through contradiction, and remains explicitly estimated. An unscanned outer boundary or uncertain large gap stays open. Do not fill an entire room-sized rectangle from the plane bounds.

### 3. Separate wall background from captured objects

Retain foreground furniture, fixtures and shallow picture/frame geometry using depth relief plus localized photo detail. Replace the coarse color-cell exclusion as the sole paint-ownership rule. Use object boundaries and their supporting observations to avoid preserving a wide white rectangle around artwork.

A picture should appear over a continuous wall, not create a wall opening. Where wall continuation behind an occluder is inferred, keep its estimated status. Photo-detail patches without distinct depth need a bounded overlay or a retained detail mesh that does not leave a surrounding unpainted halo. Mixed wall/object triangles need clipping or splitting along the ownership boundary; dropping an entire mixed triangle can delete the object or leave a crack.

Determine which original faces belong to the replaced wall background using footprint ownership and observation evidence, including overlapping rough wall sheets. Exclude those owned faces from the customization render. Simply adding a flat plane in front of the existing mesh would leave protruding sheets, hidden paint and flickering overlaps. Preserve uncertain foreground regions until their ownership is established.

### 4. Connect the existing customization controls and exports

Update `scanSurfaces.js`, `scanFinishRendering.js`, `ScanMesh.jsx` and the existing result-scene wiring to apply wall finishes to the derived wall mesh by wall ID. Keep the current panel, apply/reset behavior and navigation. Reset returns to the captured appearance on the prepared design surface; Geometry and Depth points retain the original scan inspection. Existing estimated-repair labeling also covers inferred design regions, so prepared geometry is not presented as new measured depth.

Wall paint must cover the whole generated wall footprint except intentional openings and visible foreground detail. Give the design mesh its own planar normals and finish material; the photographed-back shader should stay with the captured mesh. Existing flooring and ceiling finishes can continue through their current path during the first wall-specific change.

Extend `partialScanFile.js` with optional validated design-surface data and a reconstruction-version cache key. Older raw scan files can rebuild the model from their original frames, including the confirmed scan used here. New portable mesh exports should retain the design model; older portable meshes without depth evidence get a bounded mesh-only fallback and cannot claim unobserved openings or complete walls. Design estimates must not inflate measured-area quantities or overwrite the raw capture.

### 5. Prove the visible result on this scan before broadening the change

Implement and compare the single tagged wall first. Save matched-camera before/after images in both Overview and Walk inside with a contrasting paint color. Check the full wall, the picture boundary, furniture, floor/ceiling junctions and open capture edges. Numerical area improvements alone are insufficient; the previous checks proved material application, not wall smoothness.

Add focused regressions for noisy parallel background sheets, shared seams, enclosed gaps, real doors/windows, foreground occlusion, shallow artwork, mixed wall/object triangles and missing plane evidence. Verify old raw import, new portable round trips, reset behavior and immutable source arrays. Run the affected ScanSpace suites, required production build and browser validation. Profile the extra reconstruction work separately from the cheap material update, including phone completion performance before enabling it broadly.

## Acceptance criteria

- A connected supported wall footprint produces one continuous design sheet; real openings and genuinely separated supported regions remain distinct.
- Generated wall vertices are within 2 mm of their fitted plane, with consistent planar normals and no unintended internal boundary, duplicate sheet or non-manifold edge in the design mesh.
- Wall paint is continuous across that sheet. No white block around the picture, foreground object repainting, visible original-wall protrusions or overlap flicker appears in the matched walk-view comparison.
- Known openings remain open; missing outer capture coverage is not invented. Estimated repairs retain provenance and stay separate from measured quantities.
- Original capture, scanner acceptance rules, scan UI and original inspection geometry remain unchanged. Unsupported wall regions have a safe captured-surface fallback.
- Importing the confirmed earlier raw scan exercises the new wall preparation. A new scan is not required to validate this fix.

## Evidence files

- [Analysis and measured results](C:/Users/maver/AppData/Local/Temp/scanspace-wall-investigation-20261003.json)
- [Photo inspection](C:/Users/maver/AppData/Local/Temp/scanspace-wall-investigation-photo-20261003.jpg)
- [Geometry inspection](C:/Users/maver/AppData/Local/Temp/scanspace-wall-investigation-geometry-20261003.jpg)

The source capture SHA-256 remains `20ee96ba29c73849433971e3987c685928831592acd43dc5d30ccab0dd44b723`.

## Implementation record

Implemented a separate, optional wall model in `scanDesignSurfaces.js`, attached after the existing measured reconstruction and transferred by `fusion.worker.js`. Reconstruction v49 prepares fitted wall sheets on a bounded 4 cm grid. Shared lattice vertices and planar normals eliminate competing background sheets inside the prepared footprint. Independently observed openings remain holes; enclosed repairs are bounded, and unknown outer coverage remains open. Nearby wall/floor or wall/ceiling boundary vertices meet the supported plane intersection, with a displacement limit of 1.8 cm at the default grid size. An unsupported ceiling cannot authorize a global room-height cut.

`ScanMesh.jsx` renders these walls in Photo and applies the existing finishes to their continuous geometry. Original background faces in the owned footprint are hidden in that view. Mixed faces are clipped while retaining foreground positions, normals and original atlas coordinates; fragments share the captured texture. Folded background edges are eligible for replacement inside the established footprint, but cannot create new coverage. Shallow plain-wall depth bias does not retain white blocks when photographs identify ordinary wall. Substantial stable relief remains captured; flush artwork is retained as a localized photographic overlay on the planar sheet. High-resolution RGB snapshots supply appearance, without becoming depth observers, and coherent detail regions prefer a consistent photograph. Photos and finishes use the inward-facing front; an independent neutral back material prevents mirrored photographs on unseen backs without inheriting the captured mesh's shader.

Geometry and Depth points retain their original measured data. Design area is approximate footprint coverage and is never added to measured quantities. Wall continuation behind retained foreground objects is marked estimated. The scan's positions, indices and original atlas are unchanged by preparation; the confirmed capture file's SHA-256 is unchanged too. Scanner acceptance and capture controls were not changed.

Older raw captures rebuild through v49 using their saved frames. Existing checked previews older than v49 also rebuild when raw frames are available. New portable mesh exports include a bounded, validated optional model with a source-geometry fingerprint. A damaged or stale optional model falls back locally without making the measured scan unreadable. When needed, only the export copy of the captured atlas is slightly downsampled to keep the model inside the existing portable budget. Older portable meshes without depth use conservative measured-footprint preparation, with no claim of unseen openings.

### Validation record

- The confirmed raw capture was replayed through the fusion pipeline with 58 accepted depth views and 12 separate camera photographs. Its original measured mesh still has 132,598 triangles. Independent hashes of the measured positions, indices and captured atlas match before and after wall preparation.
- The prepared model covers the single tagged wall. The main connected sheet holds approximately 96.3% of its grid area; three genuinely separated supported regions remain distinct. The design wall has no non-manifold edges or winding conflicts. Its 4.83 m² grid footprint is an estimate, not a revised room measurement.
- Repeated desktop probes put the additional preparation stage at approximately 2.6–7.4 seconds, depending on concurrent build/browser work. The model occupies about 1.7 MB in the latest probe and survives portable export/import; the existing 8 MB optional-model cap and 36 MB portable binary budget remain enforced.
- The final focused run passed 36 tests across the preparation, portable file, result review and Three.js scene suites. It includes noisy parallel sheets, real openings, stationary copies, foreground occlusion, bounded holes, mixed face clipping, RGB-only snapshots, picture highlights, plain-wall depth bias, substantial white foreground objects, supported junctions, angled walls, stale model fallback, reset and original Geometry inspection.
- The full ScanSpace regression run passed 491 tests across 41 suites. The final preparation/export/review/scene run then passed 36 tests after the last preparation adjustments. The final material-side adjustment also passed all four scene tests across two suites. The production build passed with `CI=true`; `git diff --check` passed.
- The final application imported the confirmed earlier raw file through the real reconstruction worker and completed at v49 with 58 accepted depth views and 12 photographs. Both the original v48 browser result and the rebuilt v49 browser result report 132,586 measured mesh triangles. This agrees with the unchanged browser geometry; the separately instrumented Node replay's 132,598 count is recorded above rather than substituted for the browser result.
- A contrasting Forest finish is visibly continuous across the supported wall in both Overview and Walk inside. The artwork and captured furniture remain present. Reset restores the projected photographic appearance; Geometry and Depth points show the original inspection layers. A real UI export saved Forest/Matte walls, Walnut flooring and Sand/Eggshell ceiling, with the complete raw capture semantically identical to the earlier file, including all 60 source frames.
- That exported raw scan reopened successfully in the final production build at v49, restoring the saved finishes automatically. The updated preview is left in Walk inside; no new capture was required.
- [Matched overview comparison](C:/Users/maver/AppData/Local/Temp/scanspace-continuous-wall-20261003/wall-overview-comparison.png) and [matched walk comparison](C:/Users/maver/AppData/Local/Temp/scanspace-continuous-wall-20261003/wall-walk-comparison.png) compare the same reset cameras and viewport. The screenshots remain private local artifacts, outside the repository. [Preparation metrics](C:/Users/maver/AppData/Local/Temp/scanspace-continuous-wall-20261003/design-report.json) and [raw export validation](C:/Users/maver/AppData/Local/Temp/scanspace-continuous-wall-20261003/raw-export-validation.json) record the numerical checks.

### Practical limits

This first change targets the supported tagged wall. It does not infer the untagged curtain-facing sheet as another wall or invent missing outer walls/ceilings. Furniture, uncertain capture edges and the original Geometry view can still show capture defects. Photo projection uses the saved poses, so imperfect registration or occluded parts may retain seams. Desktop validation does not establish phone completion time or memory use; that remains a device check.

## Wall separation attempt: reconstruction v50 (superseded)

The reported side-view separation is a regression from wall preparation. Flattened background faces moved onto their fitted plane while their adjoining retained geometry stayed at the captured positions. The confirmed scan has 3,149 shared source edges across this ownership boundary; their maximum displacement is approximately 18 cm. It has no detected opening in this wall. Frontal paint checks did not reveal these broken connections.

Wall preparation now adds estimated transition geometry along formerly connected source edges and clipped background boundaries. Geometric adjacency uses numerical duplicates across the captured atlas seams, with a 1 micrometre key; nearby disconnected components cannot qualify. Each strip is split against the prepared footprint and stops at independently observed openings or protected foreground. Its planar endpoint follows the actual wall triangles, including supported junction snaps. The editable wall face remains planar, and all original measured arrays remain intact.

The user's next screenshot exposed a failed visual criterion: these transition strips formed broad uniform-colored fins in side view. Closing the gap numerically did not produce an acceptable photographed room surface. The v51 correction below replaces this approach; the v50 screenshots record the regression rather than a successful final seam repair.

These joins have separate material ownership within the optional fragment mesh. They continue the wall's dominant surrounding color in Photo and receive the selected wall finish when painted. Retained captured details keep their atlas coordinates and photographs. The estimated strips' unphotographed interiors are not assigned stretched edge photographs. Their estimated area is separate diagnostic information and is not added to measured room quantities. Portable export/import preserves this material boundary and validates its triangle range; damaged optional data still falls back locally. Raw checked previews from v49 and earlier rebuild through v50.

The final affected regression run passed 55 tests across six suites, including side-junction closure, supported boundary snaps, unchanged source arrays, unrelated nearby geometry, true openings, foreground protection, paint/reset, portable ownership and stale raw previews. The production build passed. On the confirmed captured geometry, preparation took approximately 2.5 seconds in the final desktop probe, with a valid 2.59 MB optional model. The measured positions, indices and captured atlas hashes are unchanged, as is the original raw capture file hash.

[Matched side-angle comparison](C:/Users/maver/AppData/Local/Temp/scanspace-continuous-wall-20261003/gap-side-comparison.png) shows the reproduced v49 separation and the corrected v50 joins on the same measured geometry, restored captured finishes, reset camera and orbit gestures. Paint coverage was also checked from the side and in Walk inside. Remaining unsupported outer edges and holes in the original disconnected capture are still visible; this correction reconnects boundaries broken by flattening rather than asserting a complete room shell.

The original October 2 raw file also completed reconstruction through the application's actual worker at v50, reporting 58 depth views, 12 photographs and the same 132,586 measured triangles as the previous browser result. Its repaired Photo side view matches the model probe. Geometry and Depth points still display the original capture, and the preview reports no console errors. [Raw-file side view](C:/Users/maver/AppData/Local/Temp/scanspace-continuous-wall-20261003/gap-raw-v50-side-full.png) records this separate import check.

## Photographic seam attempt: reconstruction v51 (superseded)

The next user check exposed an unresolved vertical separation. Limiting edge movement to floor/ceiling junctions avoided spikes but deliberately skipped the adjoining vertical captured surface. The matched side screenshot below therefore records an incomplete repair. Passing the focused tests and removing colored fins did not satisfy the wall-connection requirement.

Implementation sequence for the reported colored-fill regression:

1. Remove the off-plane transition ribbons and their separate uniform wall-color material.
2. Move the display copy of adjoining captured floor/ceiling edges onto the actual prepared wall boundary. Split shared edges at wall-cell intersections, retaining interpolated original photograph UVs and source-face ownership. Geometric welding spans atlas duplicates. Real openings and foreground protection veto adjustment; unrelated nearby surfaces cannot qualify.
3. Preserve captured object shapes instead of deforming arbitrary wall/object boundaries. A first visual check caught thin texture spikes from overly broad edge adjustment, so final adjustment is limited to room-surface junctions. Replace additional displaced background sheets behind the wall using the existing supported footprint; retain the narrower foreground band. Clip remaining geometry behind independently supported wall cells at the wall plane, preserving photo interpolation and leaving openings/unknown coverage open.
4. Carry each adjusted fragment's original floor/ceiling material label into the existing finish renderer. Captured photographs still use UV0; flooring gets metric UV1. Reset restores the photo on the adjusted edge, rather than a flat color estimate. Keep the original measured mesh in Geometry and Depth points.
5. Version the optional prepared model as schema 2 and reconstruction 51. Preserve an explicit fragment estimate mask through worker transfer and portable exports. Old raw previews rebuild from their original frames; obsolete schema-1 optional models fall back to the captured mesh instead of resurrecting the ribbons.
6. Check the confirmed scan in the real browser from a matched desktop side angle, front and Walk inside; exercise paint, floor finish, reset, original raw-file import, affected tests and the production build before delivery.

The final model probe adjusts 708 captured triangles at room-surface joins, emits 2,635 retained/adjusted fragment triangles, and occupies 1.79 MB. The fitted wall remains planar with no non-manifold edges or winding conflicts. Hashes of measured positions, indices and the original atlas are unchanged. The source capture SHA-256 is unchanged. The optional model and photo/source ownership survive portable export/import.

The focused run passed 59 tests across six suites. Added regressions cover preserved edge photographs, floor finish ownership after deformation, duplicate background cleanup, behind-wall clipping with interpolated UVs, retained openings, protected foreground, disconnected neighbors, obsolete-model fallback and raw v50 preview rebuilding. The matching side view has neither the v50 white fins nor the rejected intermediate photo spikes. Front and Walk inside checks retain the picture and captured furniture; paint covers the prepared wall and flooring reaches the adjusted floor edge. Unsupported outer scan edges and unprepared room surfaces remain capture limitations.

Private visual evidence and probe reports are under `C:/Users/maver/AppData/Local/Temp/scanspace-wall-seam-20261003/`, outside the repository. Desktop preparation time in the final probe was approximately 10 seconds while build/browser work was active; phone performance is not established by this test.

Final application validation imported the original October 2 raw file through the real reconstruction worker at v51: 58 accepted depth views, 12 camera photographs, and the same 132,586 measured triangles reported by v49/v50 in the browser. Its photographed side view matches the corrected model probe. Geometry and Depth points render the original data, and no console errors were reported. The targeted fusion integration test passed in addition to the 59 focused tests. The production build passed with `CI=true` after correcting lint findings. [Matched raw-file side comparison](C:/Users/maver/AppData/Local/Temp/scanspace-wall-seam-20261003/wall-seam-comparison.png) records the removed colored strips; the front and walk screenshots record the retained photographs and finish application.

## Connected photographed surfaces: reconstruction v52

The fitted wall position agrees with the dominant captured wall surface (area-weighted median residual approximately -1.3 mm). Moving the whole plane to meet a displaced layer would relocate the wall incorrectly. Instead, reconnect the existing neighboring surface that was previously attached to the replaced background.

Implementation sequence:

1. Include vertical captured joins as well as floor/ceiling joins. Derive constraints only from actual shared source edges or clipped ownership boundaries, including geometric duplicates at photo-atlas seams. Project these constraints onto the actual prepared triangles. Independently observed openings, protected foreground and incompatible targets at shared wall corners still prevent an adjustment.
2. Spread the constrained displacement through the existing connected captured triangles over a bounded 35 cm geodesic neighborhood. Keep the seam fixed on the prepared wall and the distant/protected capture fixed. A weighted displacement relaxation distributes the correction rather than stretching a single ring of tiny edge triangles into spikes.
3. Remap a display copy of the affected triangles, retaining their original photo coordinates, colors and source-face ownership. Boundary subdivisions interpolate the original photograph. Recompute geometric normals; subdivision centers follow the deformed triangle rather than staying at their old location. This introduces no off-plane transition ribbons or uniform-colored filler faces.
4. Keep all measured geometry, the source atlas, raw depth and camera frames unchanged. Original Geometry/Depth inspection remains available. Adjusted display fragments retain their estimated status and existing finish ownership; the correction does not create new measured coverage.
5. Require reconstruction 52 for reusable optional design models, even when they use the same schema 2. Discard a stale v51 optional model locally while preserving its measured mesh; older checked raw previews rebuild from saved frames.

The real captured-geometry probe reconnects 3,673 seam constraint points and distributes their movement through 32,348 existing source triangles. The resulting optional model occupies 5.81 MB, below the existing 8 MB cap. Preparation took 14.7 seconds in the desktop probe. The unchanged fitted wall remains planar with no non-manifold edges or winding conflicts. Independent measured positions, indices and atlas hashes remain identical, and the optional model survives portable export/import. The source photograph is slightly downsampled on the export copy only to fit the existing portable budget.

The first focused run passed 61 tests across six suites. The added vertical-wall regression checks a single connected visible surface with no non-manifold edges or winding conflicts, original photo interpolation, correction extending into the neighboring surface, and unchanged measured arrays. Existing regressions check real openings, protected foreground, disconnected neighbors, floor/ceiling joins, photo/finish ownership and portable fallback.

The final focused run also passed all 61 tests after the lint correction and the additional stale-v51 portable-model assertion. The targeted fusion integration test passed separately. The production build passed with `CI=true`, and `git diff --check` passed.

Matched desktop side and oblique Photo checks on the confirmed captured geometry show the reported vertical separation closed with the captured appearance. Front, Forest paint, Walnut flooring, reset and Walk inside checks retain the artwork and furniture. Private screenshots and reports remain under `C:/Users/maver/AppData/Local/Temp/scanspace-connected-walls-20261003/`, outside the repository.

The original October 2 raw capture also completed reconstruction through the application's actual worker at v52 with 58 accepted depth views, 12 photographs and 132,586 original measured triangles. Its matched side view closes the v51 separation. Geometry and Depth points still show the original captured data, and the browser reports no console errors. The source file SHA-256 remains `20ee96ba29c73849433971e3987c685928831592acd43dc5d30ccab0dd44b723`. [Matched raw-file side comparison](C:/Users/maver/AppData/Local/Temp/scanspace-connected-walls-20261003/wall-connection-comparison.png) and [final photographed preview](C:/Users/maver/AppData/Local/Temp/scanspace-connected-walls-20261003/raw-final.png) record the checked result.

This is a correction to a connection broken during preparation. Unsupported outer capture edges and unrelated missing/uncertain geometry still remain visible; it is not a claim that the whole room is watertight or that unseen detail was recovered. Phone completion time and memory use remain device checks.

## Bounded rear-wall placement: reconstruction v53

The next user check identified a placement problem despite the closed seam: the prepared wall appeared too far into the room beside the curtain. The user clarified that the wall should move back modestly while keeping its connection, rather than requiring a newly inferred complete corner/baseboard. The original captured geometry's median residual alone does not resolve this visual placement choice; it averages the depth sheets used in reconstruction.

`capturedWallSetback` now evaluates broad, parallel, measured wall samples inside the original independently supported footprint. It excludes the top/bottom margin and foreground offsets, lets each translated camera view vote once, and requires three independent views of a coherent rear band. The setback is capped at 6 cm. Sparse evidence, repeated stationary frames and old mesh-only files retain their fitted placement. The fitted angle is unchanged. The existing photographed-surface relaxation reconnects adjoining geometry to the revised wall position; no colored bridge or additional measured coverage is introduced.

The confirmed capture's rear-band consensus moves its prepared wall back 25.6 mm. This is an approximate design placement adjustment supported by the recorded rear depths, not a new exact room measurement. The source mesh, texture atlas, raw capture and scanner controls are unchanged. The optional model is valid and occupies 5.84 MB, survives portable export/import, and took 15.7 seconds to prepare in the desktop probe. The main sheet has no non-manifold edges or winding conflicts. The wall remains planar.

New regressions cover bounded rear placement with a conflicting foreground view, a photographed floor seam meeting the relocated wall, stationary observations preventing movement and the displacement cap. Checked raw previews from v52 rebuild, and stale v52 optional models fall back to their measured mesh. Desktop Photo side checks retain the closed join after setback; front, paint and Walk inside preserve captured furniture and artwork. The 65 affected tests passed across the six suites after normalizing a zero-valued diagnostic; the production build passed with `CI=true`. Private evidence and reports are in `C:/Users/maver/AppData/Local/Temp/scanspace-wall-realism-20261003/`.

The targeted fusion integration check passed separately, as did the final portable-file suite after adding the stale-v52 assertion. The original October 2 capture rebuilt through the application's worker at v53 with 58 depth views, 12 photographs and the unchanged 132,586 measured triangles. The photographed join remains closed in the side/oblique view, and no browser errors were reported. The source capture SHA-256 is unchanged. [Original-file photographed view](C:/Users/maver/AppData/Local/Temp/scanspace-wall-realism-20261003/raw-front.png), [original-file oblique join](C:/Users/maver/AppData/Local/Temp/scanspace-wall-realism-20261003/raw-oblique.png) and [placement metrics](C:/Users/maver/AppData/Local/Temp/scanspace-wall-realism-20261003/design-report.json) record this correction. These are verification artifacts rather than proof of exact room dimensions.

This modest adjustment does not recover unmeasured baseboard/corner detail or prove the room's exact proportions. The missing curtain-side wall and pose/appearance errors in the old capture require separate reconstruction evidence; moving the main wall farther back alone cannot supply those features.

## Wall paint under captured lighting

The previous paint renderer replaced the wall photograph with a uniform material under the viewer's generic lights, losing the room's captured shadows. Wall paint now derives a linear illumination texture from the existing prepared wall photograph. It estimates the original base tint from illuminated wall pixels, excludes protected artwork and unsupported footprint pixels, and preserves relative brightness plus restrained local light color. Nearby wall illumination extends beneath protected photo details without using the picture as a light measurement. The original photo overlay still displays the artwork.

Paint combines the selected color with this captured illumination. It avoids applying the viewer's synthetic diffuse lights and exposure a second time; Matte, Eggshell and Satin retain a restrained view-dependent reflection through their existing roughness values. The light texture uses UV0 and the material's light-map slot to avoid Fiber's automatic sRGB conversion of ordinary color maps. Older results without a prepared wall use captured atlas or linear vertex colors from identified wall faces as their light source. Reset restores the original photograph. Reconstruction remains v53: this change moves no surfaces and adds no captured geometry or portable schema fields.

The 12 focused rendering/customization tests and the production build passed. Browser checks used the user's original scan already reconstructed at v53, with Forest and Warm white paint, Matte/Satin, retained artwork, captured-photo reset and no shader errors. The matched Forest comparison shows the previously flat wall gaining the captured brightness variation. This is an estimate of paint under the recorded lighting; it assumes one original wall base paint and cannot recover illumination absent from the capture or simulate moving room lights.

## Flooring under captured lighting

Replacement flooring now uses an illumination field derived from the identified floor faces and their original camera photographs. Samples are decoded to linear color, projected into floor coordinates, and smoothed over physical distance to suppress the old flooring's fine grain and narrow grout lines. Illuminated floor samples establish the original base tint; the new plank or tile pattern receives relative brightness and restrained local light color. Portable results without photographs use their existing linear vertex colors. Insufficient exposure falls back to neutral illumination.

The captured lighting has its own nonrepeating UV2 channel, separate from the repeating floor-pattern UV1 channel and the original photo-atlas UV0 channel. Rotating or changing the pattern keeps room shadows in place. Primary floor faces and adjusted boundary fragments share the same light texture and coordinates. The material combines the new pattern with captured lighting, avoids a second synthetic diffuse-light/exposure pass, and keeps a restrained view-dependent sheen. Reset restores the captured photograph. Reconstruction remains v53; measured geometry, original photographs, scanner controls, and export fields are unchanged.

All 19 focused floor/wall lighting, finish geometry, scene, and customization tests passed, as did the production build with `CI=true` and `git diff --check`. Browser checks used the existing original-file v53 result with Walnut and Soft stone, both pattern directions, restored captured finishes, and no shader errors. The matching desktop geometry probe identified 15,147 floor faces and produced a 59 by 47 light texture at 4 cm spacing in 49–141 ms; its measured positions, indices and camera-atlas hashes remained unchanged. Private comparisons and metrics are under `C:/Users/maver/AppData/Local/Temp/scanspace-floor-lighting-20261004/`.

This illumination is estimated from captured appearance. Smoothing softens fine shadow edges, and broad variations in the old floor material may remain indistinguishable from lighting. It retains the recorded room lighting rather than predicting shadows from moved furniture or new room lights.

## Photographed floor materials

The previous floor patterns were generated from evenly spaced sine lines, repeated seams and pixel noise. Even with captured lighting, the wood looked like uniform stripes and the stone like a flat grid. These patterns are replaced by locally bundled 1K diffuse, OpenGL normal and roughness photographs from Poly Haven. [Asset sources and CC0 attribution](../src/assets/scanspace/flooring/SOURCES.md) record the original files and dimensions. All six source JPEG checksums match the official files API; together they occupy approximately 2.23 MB.

Wood uses natural grain, knots, individual board tones and staggered ends from a 1.7 m square patch. Its base tone is calibrated in linear color for the existing Natural oak, Walnut and Light oak selections. Vinyl uses shallower surface relief. Soft stone uses photographed mineral detail and varied joints, scaled to 0.6 m tile courses. Color, normal and roughness maps share the same orientation and repeating UV1 coordinates; the captured lighting remains fixed in UV2. Mipmaps and modest anisotropic filtering reduce distant grain shimmer. Normal detail receives restrained local relighting and sheen, with minimum roughness limits to avoid an overly glossy floor. These details do not displace the mesh or change reconstruction v53, scanner controls, measurements or saved finish fields.

Decoded source images are reused across selections. Each active material owns its three GPU texture copies; the main floor and adjusted boundary faces share them. Rotation, replacement and reset dispose obsolete copies. A late asynchronous selection cannot replace the current finish, and the original captured floor remains visible during loading or after an image error. Failed image requests are removed from the image cache so subsequent selections can retry.

All 23 affected lighting, material, geometry, scene and customization tests passed, including image reuse, map disposal, delayed selections, failed loads, reset/reapply, and consistent floor-boundary ownership. The production build passed with `CI=true`. Browser checks used the original-file v53 result with all four finishes, rotated grain, captured-photo reset, restored wall paint, and no shader errors. Matched private screenshots are in `C:/Users/maver/AppData/Local/Temp/scanspace-floor-materials-20261004/`. These are material previews using the captured lighting estimate; the retained scan's missing geometry and appearance errors remain separate reconstruction concerns.

## Wall shadows and photo ownership

Reconstruction v54 corrects a wall-detail classification error. Previously, a sufficiently dark wall region was protected as an object based on raw RGB difference. That kept its original appearance over the paint and excluded its shadow from wall-light estimation. Broad rectangles around irregular photo details could also protect bare wall near shelving.

Wall detail now compares color in linear space after allowing brightness to change. Smooth gradients, deep shadows and single hard shadow edges remain editable and supply their captured illumination to the existing paint material. Chromatic detail, repeated internal photographic contrast and substantial independently observed relief protect objects. A dense rectangular photo region with four observed sides and object-detail anchors preserves neutral picture backgrounds and highlights; darkness alone cannot create that protection. Other detail regions preserve enclosed highlights by following their contour instead of expanding a rectangular mask over surrounding wall. Portable meshes use the same classification with texture samples confined to their source triangles; two sample phases reduce aliasing of monochrome artwork.

Shallow noisy wall pieces that were retained because of an erroneous shadow mask can now be replaced by the existing flat wall surface. The wall position, supported footprint, opening protection and existing seam reconnection are preserved. This changes finished-result preparation, not capture checks or scanner controls. The original photographs, UVs and measured positions/indices remain intact. The version change rebuilds older raw previews and prevents reuse of stale v53 preparation. Older portable files retain their measured mesh if optional preparation is stale.

The private replay of the user-confirmed October 2 scan keeps the prepared wall at the same offset and retains its 4.6784 m² supported footprint. Protected photo pixels fall from 30.54% to 22.39%; this is a mask diagnostic, not a claim that every excluded pixel is bare wall. The complete picture remains protected, while many surrounding wall cells become editable. The replay remains within the 8 MiB preparation budget, retains the optional model through export/import, and preserves hashes of measured positions, indices, UVs and the original atlas. Private diagnostic artifacts are in `C:/Users/maver/AppData/Local/Temp/scanspace-wall-shadows-20261004/`.

All 145 affected reconstruction, ownership, portable-file and review/scene tests passed, along with the six existing wall-lighting tests. The final production build passed with `CI=true`; its source maps were checked against the final classification and preparation sources. Browser verification checked Slate and Warm white paint, photographic reset, retained artwork and shelf shadows. The original raw file rebuilt in the application at v54 with the same 58 depth views, 12 photographs and 132,586 measured triangles as the preceding browser result. No browser rendering errors were reported, and the original capture SHA-256 remains `20ee96ba29c73849433971e3987c685928831592acd43dc5d30ccab0dd44b723`.
