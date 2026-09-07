# Replaying a ScanSpace depth failure

Open the customer ScanSpace page with `?scanspaceDebug=1` (or add
`&scanspaceDebug=1` if there is already a query string), then start a new scan.
After finishing, use **Download scan diagnostics** on the partial or full room
review. The existing capture-screen download remains available.

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
disabled; incompatible frames are still rejected. `algorithmVersion: 6`
identifies the canonical view-grid geometry and separate depth/color visibility
paths.

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
