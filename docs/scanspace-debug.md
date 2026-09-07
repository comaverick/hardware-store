# Replaying a ScanSpace depth failure

Open the customer ScanSpace page with `?scanspaceDebug=1` (or add
`&scanspaceDebug=1` if there is already a query string), then start a new scan.
After finishing, use **Download scan diagnostics** on the partial or full room
review. The existing capture-screen download remains available.

The export is captured before reconstruction transfers the typed arrays to the
worker. It contains depth grids, projection/pose matrices, point colors, original
sample counts, and the reconstruction diagnostics. Camera photos are omitted to
bound memory. The snapshot is kept only for this scan review; leaving the review
clears it.

From the customer directory:

```powershell
node scripts/replay-scanspace.mjs "C:\path\to\scanspace-debug.json"
```

The command reads the capture and prints diagnostics and mesh bounds to stdout.
It does not modify the capture or project. Pass `-` to read JSON from stdin.
Version 1 depth exports are also accepted.

Check `inputDepthSamples`, `filteredDepthSamples`, `alignment.pairs`,
`alignment.rejectedFrameIds`, `cellRejections`, and the triangle counts before
and after cleanup. Pair errors are in meters. Frame selection checks projected
depth agreement; it does not optimize camera poses (`poseCorrectionApplied`
is false). `algorithmVersion: 4` identifies the occlusion fix.

Replay uses the actual production fusion module. Geometry can be compared;
texture coverage cannot be reproduced without the omitted camera photos.
Occlusion alone never proves a deeper observation false. Only confidently
measured empty space in front of a surface can vote against old geometry.
Consistent wrong sensor readings remain possible and require examining the
capture, not adjusting a distance threshold based on screenshots.
