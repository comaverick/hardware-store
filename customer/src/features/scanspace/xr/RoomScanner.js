import * as THREE from "three";
import { VoxelCloud, unprojectDepth } from "../core/depth";
import { createRgbdKeyframe } from "../core/fusion";
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
      fusionKeyframes: 0,
      fusionKeyframeCompactions: 0,
      nearDepthWarning: false,
    };
    this.directions = new Set();
    this.observer = { x: 0, z: 0 };
    this.planes = new Map();
    this.keyframes = [];
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
            const keyframePose = this.keyframePose(view);
            const keyframeEligible = this.shouldCaptureKeyframe(keyframePose);
            let colorAt = null;
            if (
              keyframeEligible &&
              this.binding &&
              view.camera &&
              !this.colorFailed
            ) {
              try {
                this.colorReader ??= createCameraColorReader(
                  this.renderer.getContext(),
                );
                colorAt = this.colorReader.read(this.binding, view.camera);
                if (colorAt) this.stats.colorActive = true;
              } catch (error) {
                this.colorFailures = (this.colorFailures || 0) + 1;
                this.colorFailed = this.colorFailures >= 3;
                this.stats.errors.push(
                  `Captured color unavailable: ${error.message}`,
                );
              } finally {
                this.renderer.resetState();
              }
            }
            // Preserve more of the device depth image while keeping a bounded
            // grid for mid-range phones. Rows follow the real depth aspect.
            const columns = Math.min(depth.width, colorAt ? 72 : 60);
            const rows = Math.min(
              depth.height,
              Math.max(36, Math.round((columns * depth.height) / depth.width)),
            );
            const framePoints = unprojectDepth(
              depth,
              view,
              columns,
              rows,
              colorAt,
            );
            const nearPointCount = framePoints.reduce(
              (count, point) => count + (point.depth < 0.7 ? 1 : 0),
              0,
            );
            const nearRatio = framePoints.length
              ? nearPointCount / framePoints.length
              : 0;
            this.stats.nearDepthWarning = nearRatio > 0.12;
            this.cloud.add(framePoints, this.stats.depthFrames);
            // Pose gating inside captureKeyframe decides whether this depth
            // view adds useful parallax. Checking every depth frame prevents a
            // slow single-wall sweep from falling between a timer cadence.
            if (keyframeEligible)
              this.captureKeyframe(
                framePoints,
                view,
                columns,
                rows,
                time,
                colorAt,
                keyframePose,
              );
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
  keyframePose(view) {
    const position = view.transform.position;
    const orientation = view.transform.orientation;
    return {
      position: { x: position.x, y: position.y, z: position.z },
      orientation: {
        x: orientation?.x || 0,
        y: orientation?.y || 0,
        z: orientation?.z || 0,
        w: orientation?.w ?? 1,
      },
    };
  }
  shouldCaptureKeyframe(pose) {
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
      // Slightly denser poses improve projective overlap without retaining
      // every XR frame. The global keyframe cap still bounds phone memory.
      if (moved < 0.08 && turned < 0.1) return false;
    }
    return true;
  }
  captureKeyframe(
    points,
    view,
    columns,
    rows,
    timestamp,
    colorAt,
    pose = this.keyframePose(view),
  ) {
    const keyframe = createRgbdKeyframe(points, {
      columns,
      rows,
      projectionMatrix: view.projectionMatrix,
      transformMatrix: view.transform.matrix,
      camera: pose.position,
      timestamp,
      colorImage: colorAt?.snapshot?.(),
    });
    if (!keyframe) return;
    // A bounded set is important on phones: the worker receives at most sixty
    // compact grids, not a growing collection of full per-frame meshes.
    if (this.keyframes.length >= 60) {
      this.keyframes = this.keyframes.filter((_, index) => index % 2 === 0);
      this.stats.fusionKeyframeCompactions++;
    }
    this.keyframes.push(keyframe);
    this.lastMeshPose = pose;
    this.stats.fusionKeyframes = this.keyframes.length;
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
      keyframes: this.keyframes,
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
