# ScanSpace scanning investigation and implementation plan

Prepared September 30, 2026. Investigated checkout: `861fde2`; installed Three.js: `0.185.1`.

This is a repair plan. No scanning implementation, UI, styling, or capture rules were changed during the investigation. The user reports that scanning failed after code edits. The recordings are evidence of behavior; instructions displayed inside them were not treated as instructions for this task.

**What the recordings show**

Times are approximate offsets within each recording, based on sampled frames.

| Recording | Observed behavior | Interpretation |
| --- | --- | --- |
| `Screenrecorder-2026-09-30-18-48-36-96.mp4` | Initially saves no views; reaches 2 around 9 seconds, 10 around 15 seconds, and 11 around 17 seconds. Remains at 11 through the end, displaying "Connecting this view" while the camera remains live. | New views are being withheld by connection validation. The recording does not establish a crash or missing-depth failure for this attempt. Eleven views is below the existing 60-view limit. |
| `Screenrecorder-2026-09-30-18-49-03-14.mp4` | Saves zero views. Displays "Depth signal interrupted" around 7 seconds, then "Depth sensor stopped responding" around 15 seconds. Camera movement continues through the end. | The displayed messages correspond to the missing-depth path, rather than the separate exception or stopped-XR-callback labels. The native reason for absent depth is not visible. |
| `Screenrecorder-2026-09-30-18-49-37-655.mp4` | Again saves zero views and follows the same interrupted/stopped depth sequence while camera imagery continues. | A repeat of the missing-depth symptom, rather than evidence that the overlap thresholds need changing. |

The latest commit restored the scanner and adaptive-capture modules to their `c4e04c4` state. This helps identify the code under investigation but does not prove which build was deployed to the phone. Confirm the deployed build identifier before comparing versions. Reapplying today's reverted changes wholesale would also restore UI and algorithm changes outside the requested scope.

**Findings established in the current implementation**

1. **One transient frame error permanently disables acquisition.** In `src/features/scanspace/xr/RoomScanner.js:955`, the outer `frame()` catch sets `paused = true`. Subsequent frames skip depth acquisition, and the watchdog also skips paused scanners. Using the existing replay loader against the actual scanner module, one-time failures in hit testing, viewer-pose reading, preview maintenance, and rendering each left the scanner paused after healthy frames returned, with zero additional depth reads and the two saved views preserved. This is a reproduced error-handling defect. The recordings do not prove that this catch was their trigger.

2. **RGB readback drops the active XR render target.** The color-readback `finally` at `RoomScanner.js:676` calls `renderer.resetState()` without restoring the render target. In the installed Three.js source, `WebGLRenderer.js:3558` clears the active target to `null`; `WebXRManager.js:916` binds the XR target before invoking the application's callback. A scanner harness using those reset semantics observed one reset, zero target restores, and a null target after capture. This verifies a renderer integration defect; its effect on depth availability on this phone remains unverified. [Three.js rendering documentation](https://threejs.org/docs/pages/WebGLRenderer.html#render) describes rendering to the selected target.

3. **A cleanup error aborts the remaining cleanup.** `RoomScanner.js:1598` marks the scanner closed before canceling the hit source and disposing resources. Injecting a single hit-source cancellation error prevented animation shutdown, color/renderer disposal, and `onEnd`; another cleanup attempt immediately returned because `closed` was already true. This is a reproduced lifecycle defect that can affect subsequent scan attempts. Cancellation of an inactive hit-test source can legitimately throw under the [WebXR Hit Test specification](https://www.w3.org/TR/webxr-hit-test-1/#dom-xrhittestsource-cancel).

4. **Missing-depth recovery only polls.** The existing implementation already retries reads at up to 250 ms intervals and escalates its warning after 10 seconds. It does not inspect the native session's `depthActive` flag or call its optional `resumeDepthSensing()` method. A harness with inactive depth and an available resume method reached `stalled` with zero resume calls. This is a conditional recovery gap, not proof that native depth was paused in the recordings. The [WebXR Depth Sensing specification](https://www.w3.org/TR/webxr-depth-sensing-1/#dom-xrsession-depthactive) permits null data even while depth is active, and requires resumption to occur in an active XR animation frame. An active session returning null cannot be repaired simply by repeatedly calling resume.

5. **Existing tests miss these paths.** Six relevant suites passed: 113 tests total. They cover depth interruptions, overlap recovery, motion rejection, geometry validation, and review behavior. The camera tests mainly check image quality; renderer fixtures make `resetState()` a no-op. They do not establish actual XR framebuffer preservation or safe teardown. Production hides the existing diagnostics panel, and debug download requires saved keyframes, making the zero-view failures difficult to diagnose.

**Implementation order**

1. **Capture the failing device state and add regression cases.** Extend the existing bounded diagnostics behind an opt-in debug flag, without adding visible controls. Record build/browser identifiers, negotiated depth configuration, native `depthActive` when available, session visibility, XR callback/read counts, missing-depth versus exception counts, error stage/name, and processing/readback timing. Allow a diagnostic snapshot with zero saved views. Keep it local and bounded. Add tests reproducing the three established defects before changing behavior. For the 11-view case, capture the existing rejection reason and overlap/residual measurements; do not infer a bad threshold from the saved-view count alone.

2. **Repair camera readback state restoration.** In `RoomScanner.js` and, where necessary, `xr/cameraColor.js`, preserve the current XR render target and applicable renderer state before camera copying. Restore it in `finally` after resetting Three.js state, on success and failure. Keep opaque XR textures within their frame lifetime. A failed RGB copy must discard that color observation and retain the depth-only capture path. Preserve resolution limits, readback cadence, and texture-selection rules.

3. **Contain recoverable frame errors.** Separate pose/depth acquisition from hit testing, plane bookkeeping, preview maintenance, and rendering error boundaries. A hit-test or preview failure should skip that auxiliary operation. A pose failure should withhold geometry and use the existing tracking-recovery checks when valid poses return. Healthy later callbacks must continue acquisition. Preserve deliberate pause during review, user pause, and the existing mandatory stop after a coordinate-origin reset. Record fatal failures explicitly rather than automatically treating every exception as a deliberate pause.

4. **Make teardown complete and repeatable.** Ensure a failed cancellation/disposal does not prevent later cleanup operations or the single end notification. Stop timers and animation, release reader/scene/renderer resources, and clear references even after partial startup. Verify teardown ordering with Three.js's own session-end cleanup before disposing the renderer. Guard late callbacks from an old scanner so they cannot overwrite the current session's state. Keep Start, Cancel, Finish, and Continue flows unchanged.

5. **Repair native depth resumption only when the trace supports it.** Feature-detect the native flag and method. If depth is explicitly inactive, the session is live, and capture is not intentionally paused or invalidated by a coordinate reset, attempt bounded resumption inside a valid XR frame. Keep normal null-depth polling when the flag is true or unavailable. Preserve saved views through outages and require the existing connection validation before accepting returned geometry. If depth remains active but unavailable after the preceding fixes, use the device trace to isolate browser/AR runtime acquisition; do not claim that a software retry guarantees native sensor recovery.

**Boundaries for the repair**

Preserve the current scanner markup, styles, controls, wording, and review/save flow. Preserve CPU depth usage, raw/smooth preference, view-aligned projection, the initial two translated agreeing views, motion/sparsity/obstruction limits, bidirectional overlap and residual tests, recovery confirmations, connected graph, provisional-frame handling, and memory limits. Do not introduce continuous-capture mode, accept disconnected observations, relax thresholds, or replace the reconstruction pipeline. Limit production edits to error handling, XR/WebGL state, diagnostics, and lifecycle code. Keep the adaptive-capture acceptance rules and reconstruction algorithm outside this patch; use their existing tests to verify unchanged behavior.

**Verification after implementation**

| Check | Required result |
| --- | --- |
| A one-time pose, hit-test, plane, preview, or render error | Later valid frames are processed; retained views survive; invalid poses never contribute geometry. |
| RGB copy succeeds or throws | The same XR target is restored; failed color copying leaves valid depth acquisition available. |
| Native depth inactive / optional resume API absent / active depth returns null | Resume only for the supported inactive case in an active frame; other cases remain safe and continue bounded polling. |
| Cancel/end/startup failure, including a disposal error | All remaining resources are cleaned; end fires once; a fresh scan can start; old callbacks cannot affect it. |
| Pause/review and an actual reference-space reset | Intentional pause is respected; coordinate reset still requires a new scan. |
| Existing bootstrap, motion, overlap, drift, capacity, and review tests | All retain their current acceptance and rejection behavior. |
| Real phone, same room/route | Repeat the zero-view startup and 11-view connection scenarios; healthy depth resumes and useful overlapping views continue saving after interruptions. Review/save remains available for retained valid data. |

Run the targeted suites first, then the complete ScanSpace suite and production build after the patch. On the affected phone, test at least five start/cancel/restart cycles, a 60-second overlapping sweep, stationary hold, quick motion and settling, tracking loss/return, review/continue, and a genuine coordinate reset. Compare with screen recording enabled and disabled to isolate that extra workload. Record the negotiated raw/smooth configuration and repeat on another supported depth device where available.

Desktop fault injection establishes the code defects; it cannot establish the phone's native depth failure or confirm the repair on hardware. The remaining device-specific inputs are phone model, browser/version, deployed build identifier, and a trace spanning the first missing-depth event.

**Implementation notes — September 30, 2026**

Implemented the scoped repair in `xr/RoomScanner.js`, `xr/cameraColor.js`, `core/captureDebug.js`, and the session callbacks in `components/ScannerPanel.jsx`. The scanner markup, styles, control wording, depth preferences, acquisition intervals, acceptance thresholds, and reconstruction modules are unchanged.

- Transient pose failures now use the existing tracking-loss/reconnection checks. Hit-test, plane, preview, marker, and rendering failures are contained so later healthy XR callbacks continue acquisition.
- Camera copying restores the active XR render target, cube face, and mip level after resetting Three.js state. Invalid framebuffer/readback/context results discard color while preserving the depth path. Failed camera setup releases earlier allocations; disposal attempts every resource once.
- Native resumption occurs only when the live session explicitly reports `depthActive === false`, exposes `resumeDepthSensing()`, and capture is neither deliberately paused nor invalidated by a reference-space reset. Attempts are limited to once per second inside acquisition. Null samples with active or unknown native depth continue the existing polling path.
- Session end waits until Three.js's end listeners have run before disposing the renderer. Cleanup continues after individual failures and notifies once. Cancellation during asynchronous startup cannot install a late capture loop. Late callbacks from an old scanner cannot change the current panel state.
- Opt-in runtime diagnostics are available even with zero saved views. They retain at most 48 events, bounded error text, negotiated depth configuration, frame/read counts, native depth state, visibility/context state, and timing. They retain no camera images, point positions, or XR/GPU objects, and remain local.

To collect a phone trace, append `scanspaceDebug=1` to the page's query string (use `&` if it already has a query), then start a scan. In that page's browser console, run `window.scanspaceDebug.snapshot()` to inspect the latest state or `window.scanspaceDebug.download()` to save JSON. The last snapshot remains accessible after cancellation; starting a new scan replaces it. Normal scanning has no additional controls or automatic downloads.

Regression coverage includes transient frame errors, XR target restoration on successful/failed RGB copying, inactive/active/unknown native depth, resume failures and throttling, cleanup failures, asynchronous cancellation/end races, camera allocation/readback failures, owned color snapshots, and zero-view diagnostics. Hardware validation remains the phone procedure above; desktop tests do not confirm native sensor recovery on the recorded device.

**Completed validation**

- Verified 366 tests in 32 ScanSpace suites across the complete run and the final scanner-suite rerun. The complete run passed the 316 tests outside `RoomScanner.test.js`; its seven intermittent replay failures were resolved by mocking processing-time measurements in that synthetic replay suite. Its 50 tests then passed. This fixes host-load-dependent test cadence without changing production sampling behavior. Adaptive processing-cost behavior remains covered by the existing profile tests.
- The final production build compiled successfully using `node node_modules/react-scripts/scripts/build.js`.
- `git diff --check` passed. An AST comparison confirmed `ScannerPanel.jsx` has identical JSX to the baseline; no scanner styles or capture/reconstruction core modules changed.

Test commands: `CI=true node node_modules/react-scripts/scripts/test.js --watchAll=false --runInBand src/features/scanspace`, followed by the same command targeting `src/features/scanspace/xr/RoomScanner.test.js`. On PowerShell, set `$env:CI='true'` before invoking Node. These direct runner commands avoid the package's pretest/prebuild copy of the separate server domain module.
