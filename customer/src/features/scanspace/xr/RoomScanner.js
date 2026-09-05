import * as THREE from "three";
import { VoxelCloud, unprojectDepth } from "../core/depth";
import { createCameraColorReader } from "./cameraColor";

export class RoomScanner {
  constructor({ canvas, overlay, onUpdate, onEnd }) {
    Object.assign(this, { canvas, overlay, onUpdate, onEnd });
    this.cloud = new VoxelCloud();
    this.corners = [];
    this.paused = false;
    this.floorY = null;
    this.closed = false;
    this.stats = {
      depthFrames: 0,
      pointCount: 0,
      depthActive: false,
      colorActive: false,
      tracking: false,
      features: [],
      errors: [],
      planes: 0,
      format: "Unavailable",
      dimensions: "Unavailable",
      coverage: 0,
    };
    this.directions = new Set();
    this.observer = { x: 0, z: 0 };
    this.planes = new Map();
  }
  publish() {
    this.onUpdate({
      ...this.stats,
      corners: this.corners.map((p) => ({ ...p })),
      floorY: this.floorY,
      paused: this.paused,
      canCapture: !!this.hit,
      full: this.cloud.full,
    });
  }
  async start() {
    try {
      // Called synchronously from a user click, before any asynchronous capability probe.
      this.session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: [
          "local-floor",
          "depth-sensing",
          "dom-overlay",
          "camera-access",
          "plane-detection",
          "anchors",
        ],
        depthSensing: {
          usagePreference: ["cpu-optimized"],
          dataFormatPreference: ["float32", "luminance-alpha"],
        },
        domOverlay: { root: this.overlay },
      });
      if (this.closed) {
        await this.session.end();
        return;
      }
      this.session.addEventListener("end", () => this.cleanup());
      // Without DOM overlay, provide a visible refusal instead of trapping the user in AR.
      if (!this.session.domOverlayState)
        throw new Error(
          "This browser cannot display ScanSpace controls in AR. Use manual measurements.",
        );
      this.stats.features = Array.from(this.session.enabledFeatures || []);
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: false,
      });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.xr.enabled = true;
      this.renderer.xr.setReferenceSpaceType("local");
      this.renderer.setClearColor(0, 0);
      await this.renderer.xr.setSession(this.session);
      try {
        this.space = await this.session.requestReferenceSpace("local-floor");
      } catch {
        this.space = await this.session.requestReferenceSpace("local");
      }
      this.renderer.xr.setReferenceSpace(this.space);
      this.space.addEventListener("reset", () => {
        this.originChanged = true;
        this.paused = true;
        this.hit = null;
        this.stats.errors.push(
          "Tracking origin changed. Start a new scan to avoid mixing coordinates.",
        );
        this.publish();
      });
      this.viewer = await this.session.requestReferenceSpace("viewer");
      this.hitSource = await this.session.requestHitTestSource({
        space: this.viewer,
      });
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera();
      this.reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.055, 0.075, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: "#ffb36d",
          side: THREE.DoubleSide,
        }),
      );
      this.reticle.matrixAutoUpdate = false;
      this.reticle.visible = false;
      this.scene.add(this.reticle);
      this.pointGeometry = new THREE.BufferGeometry();
      this.positions = new Float32Array(24000 * 3);
      this.colors = new Float32Array(24000 * 3);
      this.pointGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(this.positions, 3),
      );
      this.pointGeometry.setAttribute(
        "color",
        new THREE.BufferAttribute(this.colors, 3),
      );
      this.pointGeometry.setDrawRange(0, 0);
      const points = new THREE.Points(
        this.pointGeometry,
        new THREE.PointsMaterial({
          size: 0.018,
          vertexColors: true,
          transparent: true,
          opacity: 0.8,
        }),
      );
      points.frustumCulled = false;
      this.scene.add(points);
      this.cornerGroup = new THREE.Group();
      this.scene.add(this.cornerGroup);
      if (typeof window.XRWebGLBinding === "function")
        this.binding = new window.XRWebGLBinding(
          this.session,
          this.renderer.getContext(),
        );
      this.session.addEventListener("select", () => {
        if (!this.paused) this.captureCorner();
      });
      this.overlay.addEventListener(
        "beforexrselect",
        (this.preventSelect = (e) => e.preventDefault()),
      );
      this.renderer.setAnimationLoop((time, frame) => this.frame(time, frame));
      this.publish();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  frame(time, frame) {
    if (!frame || this.closed) return;
    try {
      const pose = frame.getViewerPose(this.space);
      this.stats.tracking = !!pose;
      this.hit = null;
      this.reticle.visible = false;
      if (pose) {
        this.observer = {
          x: pose.transform.position.x,
          z: pose.transform.position.z,
        };
        const hit = frame
          .getHitTestResults(this.hitSource)[0]
          ?.getPose(this.space);
        if (hit && hit.transform.matrix[5] > 0.85) {
          this.hit = {
            x: hit.transform.position.x,
            y: hit.transform.position.y,
            z: hit.transform.position.z,
          };
          this.reticle.matrix.fromArray(hit.transform.matrix);
          this.reticle.visible = true;
        }
        if (!this.paused && time - (this.lastCapture || 0) > 180) {
          this.lastCapture = time;
          const view = pose.views[0];
          let depth = null;
          if (
            this.session.depthUsage === "cpu-optimized" &&
            typeof frame.getDepthInformation === "function"
          )
            depth = frame.getDepthInformation(view);
          if (depth) {
            this.lastDepthAt = time;
            this.stats.depthFrames++;
            this.stats.depthActive = true;
            this.stats.format = this.session.depthDataFormat;
            this.stats.dimensions = `${depth.width} × ${depth.height}`;
            let colorAt = null;
            if (this.binding && view.camera && !this.colorFailed) {
              try {
                this.colorReader ??= createCameraColorReader(
                  this.renderer.getContext(),
                );
                colorAt = this.colorReader.read(this.binding, view.camera);
                if (colorAt) this.stats.colorActive = true;
              } catch (error) {
                this.colorFailed = true;
                this.stats.errors.push(
                  `Captured color unavailable: ${error.message}`,
                );
              } finally {
                this.renderer.resetState();
              }
            }
            this.cloud.add(
              unprojectDepth(depth, view, 56, 42, colorAt),
              this.stats.depthFrames,
            );
            const m = view.transform.matrix;
            this.directions.add(
              Math.floor(
                ((Math.atan2(-m[8], -m[10]) + Math.PI) / (Math.PI * 2)) * 24,
              ),
            );
            this.stats.coverage = Math.min(
              100,
              Math.round((this.directions.size / 24) * 100),
            );
          }
          if (frame.detectedPlanes) {
            for (const plane of this.planes.keys())
              if (!frame.detectedPlanes.has(plane)) this.planes.delete(plane);
            for (const plane of frame.detectedPlanes) {
              const pp = frame.getPose(plane.planeSpace, this.space);
              if (!pp) continue;
              const matrix = new THREE.Matrix4().fromArray(pp.transform.matrix);
              this.planes.set(plane, {
                orientation: plane.orientation,
                polygon: Array.from(plane.polygon, (p) =>
                  new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(matrix),
                ),
              });
            }
            this.stats.planes = this.planes.size;
          }
        }
      }
      if (time - (this.lastPublish || 0) > 500) {
        this.stats.depthCurrent =
          !!this.lastDepthAt && time - this.lastDepthAt < 2000;
        this.lastPublish = time;
        this.updatePreview();
        this.publish();
      }
      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      this.paused = true;
      this.stats.errors = [...this.stats.errors.slice(-5), error.message];
      this.publish();
    }
  }
  updatePreview() {
    const points = this.cloud.values(),
      stride = Math.max(1, Math.ceil(points.length / 24000));
    let count = 0;
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i];
      this.positions.set([p.x, p.y, p.z], count * 3);
      const c = p.color
        ? new THREE.Color().setRGB(
            ...p.color.map((v) => v / 255),
            THREE.SRGBColorSpace,
          )
        : new THREE.Color("#eba46c");
      this.colors.set([c.r, c.g, c.b], count * 3);
      count++;
    }
    this.pointGeometry.attributes.position.needsUpdate = true;
    this.pointGeometry.attributes.color.needsUpdate = true;
    this.pointGeometry.setDrawRange(0, count);
    this.stats.pointCount = points.length;
  }
  calibrateFloor() {
    if (!this.hit) throw new Error("Aim at the floor until the ring appears.");
    this.floorY = this.hit.y;
    this.publish();
  }
  captureCorner() {
    if (!this.hit || this.paused) return;
    if (this.floorY === null) this.floorY = this.hit.y;
    if (Math.abs(this.hit.y - this.floorY) > 0.18) {
      this.stats.errors.push("Aim at a corner on the calibrated floor.");
      this.publish();
      return;
    }
    const last = this.corners[this.corners.length - 1];
    if (
      this.corners.length >= 32 ||
      (last && Math.hypot(last.x - this.hit.x, last.z - this.hit.z) < 0.2)
    )
      return;
    this.corners.push({ ...this.hit });
    this.redrawCorners();
    this.publish();
  }
  redrawCorners() {
    for (const child of [...this.cornerGroup.children]) {
      this.cornerGroup.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
    this.corners.forEach((p, i) => {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 10, 8),
        new THREE.MeshBasicMaterial({ color: "#ff8d48" }),
      );
      dot.position.set(p.x, p.y + 0.025, p.z);
      this.cornerGroup.add(dot);
      if (i) {
        const prev = this.corners[i - 1],
          line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(prev.x, prev.y + 0.025, prev.z),
              new THREE.Vector3(p.x, p.y + 0.025, p.z),
            ]),
            new THREE.LineBasicMaterial({ color: "#ffb36d" }),
          );
        this.cornerGroup.add(line);
      }
    });
  }
  undo() {
    this.corners.pop();
    this.redrawCorners();
    this.publish();
  }
  togglePause() {
    if (this.originChanged) return;
    this.paused = !this.paused;
    this.publish();
  }
  result() {
    if (this.originChanged)
      throw new Error(
        "Tracking origin changed. Start a new scan before reconstructing the room.",
      );
    return {
      points: this.cloud.values(true),
      corners: this.corners.map((p) => ({ ...p })),
      floorY: this.floorY,
      observer: this.observer,
      stats: { ...this.stats },
    };
  }
  async stop() {
    if (this.session && !this.closed) {
      try {
        await this.session.end();
      } catch {
        this.cleanup();
      }
    } else this.cleanup();
  }
  cleanup() {
    if (this.closed) return;
    this.closed = true;
    this.hitSource?.cancel();
    this.renderer?.setAnimationLoop(null);
    this.colorReader?.dispose();
    this.scene?.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) o.material.dispose();
    });
    this.renderer?.dispose();
    this.overlay?.removeEventListener("beforexrselect", this.preventSelect);
    this.onEnd?.();
  }
}
