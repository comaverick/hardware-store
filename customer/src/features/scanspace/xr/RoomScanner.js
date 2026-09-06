import * as THREE from "three";
import { VoxelCloud, unprojectDepth } from "../core/depth";
import { buildDepthMeshFrame, mergeScanMesh } from "../core/scanMesh";
import { createCameraColorReader } from "./cameraColor";

export class RoomScanner {
  constructor({ canvas, overlay, onUpdate, onEnd }) {
    Object.assign(this, { canvas, overlay, onUpdate, onEnd });
    this.cloud = new VoxelCloud();
    this.paused = false;
    this.floorY = null;
    this.closed = false;
    this.stats = {
      depthFrames: 0,
      pointCount: 0,
      stablePointCount: 0,
      cloudCellSize: this.cloud.size,
      cloudCompactions: 0,
      floorAutoDetected: false,
      depthActive: false,
      colorActive: false,
      tracking: false,
      features: [],
      errors: [],
      planes: 0,
      format: "Unavailable",
      dimensions: "Unavailable",
      coverage: 0,
      directionCoverage: Array(24).fill(false),
      currentDirection: 0,
      meshFrames: 0,
      meshTriangles: 0,
      meshCompactions: 0,
    };
    this.directions = new Set();
    this.observer = { x: 0, z: 0 };
    this.planes = new Map();
    this.meshFrames = [];
    this.meshVertexCount = 0;
    this.meshTriangleCount = 0;
  }
  publish() {
    this.onUpdate({
      ...this.stats,
      floorY: this.floorY,
      paused: this.paused,
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
          "This browser cannot display ScanSpace controls in AR. Try a compatible Android browser.",
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
      this.pointGeometry = new THREE.BufferGeometry();
      this.positions = new Float32Array(12000 * 3);
      this.colors = new Float32Array(12000 * 3);
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
          size: 0.03,
          vertexColors: true,
          transparent: true,
          opacity: 0.82,
          depthWrite: false,
        }),
      );
      points.frustumCulled = false;
      this.scene.add(points);
      if (typeof window.XRWebGLBinding === "function")
        this.binding = new window.XRWebGLBinding(
          this.session,
          this.renderer.getContext(),
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
          // Prefer the lowest stable horizontal hit. This avoids asking the
          // customer to calibrate a floor while naturally correcting a table
          // or counter hit once the actual floor comes into view.
          if (this.floorY === null || hit.transform.position.y < this.floorY) {
            this.floorY = hit.transform.position.y;
            this.stats.floorAutoDetected = true;
          }
        }
        if (!this.paused && time - (this.lastCapture || 0) > 400) {
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
            if (
              this.binding &&
              view.camera &&
              !this.colorFailed &&
              this.stats.depthFrames % 5 === 1
            ) {
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
            const columns = colorAt ? 48 : 36;
            const rows = colorAt ? 36 : 27;
            const framePoints = unprojectDepth(
              depth,
              view,
              columns,
              rows,
              colorAt,
            );
            this.cloud.add(framePoints, this.stats.depthFrames);
            if (
              colorAt ||
              (!this.stats.colorActive && this.stats.depthFrames % 5 === 1)
            )
              this.captureMeshFrame(framePoints, view, columns, rows);
            this.stats.cloudCellSize = this.cloud.size;
            this.stats.cloudCompactions = this.cloud.compactions;
            const m = view.transform.matrix;
            const direction =
              Math.floor(
                ((Math.atan2(-m[8], -m[10]) + Math.PI) / (Math.PI * 2)) * 24,
              ) % 24;
            this.directions.add(direction);
            this.stats.currentDirection = direction;
            this.stats.directionCoverage = Array.from(
              { length: 24 },
              (_, index) => this.directions.has(index),
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
              this.planes.set(plane, { orientation: plane.orientation });
            }
            this.stats.planes = this.planes.size;
          }
        }
      }
      if (time - (this.lastPublish || 0) > 800) {
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
      stride = Math.max(1, Math.ceil(points.length / 12000));
    let count = 0;
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i];
      this.positions.set([p.x, p.y, p.z], count * 3);
      // These are measured points, not reconstructed surfaces. Brighter mint
      // means the depth is stable; subdued points are still being confirmed.
      const c = new THREE.Color(p.hits > 1 ? "#83f2cb" : "#3d7565");
      this.colors.set([c.r, c.g, c.b], count * 3);
      count++;
    }
    this.pointGeometry.attributes.position.needsUpdate = true;
    this.pointGeometry.attributes.color.needsUpdate = true;
    this.pointGeometry.setDrawRange(0, count);
    this.stats.pointCount = points.length;
    this.stats.stablePointCount = this.cloud.previewStableCount();
  }
  captureMeshFrame(points, view, columns, rows) {
    const position = view.transform.position;
    const orientation = view.transform.orientation;
    const pose = {
      position: { x: position.x, y: position.y, z: position.z },
      orientation: {
        x: orientation?.x || 0,
        y: orientation?.y || 0,
        z: orientation?.z || 0,
        w: orientation?.w ?? 1,
      },
    };
    if (this.lastMeshPose) {
      const moved = Math.hypot(
        pose.position.x - this.lastMeshPose.position.x,
        pose.position.y - this.lastMeshPose.position.y,
        pose.position.z - this.lastMeshPose.position.z,
      );
      const a = pose.orientation;
      const b = this.lastMeshPose.orientation;
      const dot = Math.min(
        1,
        Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w),
      );
      const turned = 2 * Math.acos(dot);
      if (moved < 0.12 && turned < 0.14) return;
    }
    const mesh = buildDepthMeshFrame(points, {
      columns,
      rows,
      camera: pose.position,
    });
    if (!mesh) return;
    const limit = 70000;
    if (this.meshVertexCount + mesh.vertexCount > limit) {
      this.meshFrames = this.meshFrames.filter((_, index) => index % 2 === 0);
      this.meshVertexCount = this.meshFrames.reduce(
        (sum, frame) => sum + frame.vertexCount,
        0,
      );
      this.meshTriangleCount = this.meshFrames.reduce(
        (sum, frame) => sum + frame.triangleCount,
        0,
      );
      this.stats.meshCompactions = (this.stats.meshCompactions || 0) + 1;
    }
    if (this.meshVertexCount + mesh.vertexCount > limit) return;
    this.meshFrames.push(mesh);
    this.meshVertexCount += mesh.vertexCount;
    this.meshTriangleCount += mesh.triangleCount;
    this.lastMeshPose = pose;
    this.stats.meshFrames = this.meshFrames.length;
    this.stats.meshTriangles = this.meshTriangleCount;
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
      mesh: mergeScanMesh(this.meshFrames, {
        floorY: this.floorY,
        observer: this.observer,
      }),
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
    this.onEnd?.();
  }
}
