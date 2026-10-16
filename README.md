# Scan Saver

Open a scanned mesh in the browser. Every interrupted edge drops straight down to the lowest point of the scan, the base is capped, and the result is a solid you can download.

No server and no install. The page does the work on your computer.

## Run it

Open [`vacform.html`](vacform.html) in Chrome, Edge, Firefox, or Safari. The same file works on Windows, Mac, and Linux. You can double-click it, or send it to someone else. Nothing is uploaded.

Supported scans: **STL**, **OBJ**, and **PLY**.

1. Open a file, or load the sample.
2. Choose the pull axis. Z is the default, toward the lowest point. Flip uses the highest point instead.
3. **Drop edges.** Open rims, including holes in the scan, fall to that base and the floor is capped.
4. **Download STL** for the full solid.
5. **Download STEP** for CAD.

## STEP in CAD

The STEP file is a closed faceted solid: triangular planar faces that share edges, written as an AP214 `MANIFOLD_SOLID_BREP`. Fusion 360, SolidWorks, FreeCAD, Rhino, and similar tools can import it as a dumb solid.

It is not a NURBS model. A raw scan has too many faces for a CAD kernel, so the STEP export lightens the solid to the face target (default 8,000). The STL keeps every formed triangle. The unit menu only labels the file as millimetres, centimetres, metres, or inches. It does not rescale the numbers. Pick the unit your scan was saved in.

Heavy work runs off the page thread, so orbiting stays available while a large scan is forming. A scan of several million triangles can still run out of memory. That limit is the browser, and the tab can be closed without affecting the rest of the computer.

## Develop

```bash
npm install
npm test
npm run build
```

`npm run build` rewrites `vacform.html`. `npm start` rebuilds it and serves the folder at <http://localhost:4173/vacform.html> for local preview.
