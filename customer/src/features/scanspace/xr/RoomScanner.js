import * as THREE from "three";
import { VoxelCloud, unprojectDepth, viewSampleGrid } from "../core/depth";
import {
  createRgbdKeyframe,
  filterDepth,
  depthPosition,
  imageSharpness,
} from "../core/fusion";
import { depthFrameQuality } from "../core/readiness";
import { createCameraColorReader } from "./cameraColor";

function roundPointTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, 32, 32);
  context.beginPath();
  context.arc(16, 16, 13, 0, Math.PI * 2);
  context.fillStyle = "#fff";
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

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
      depthType: "Unavailable",
      dimensions: "Unavailable",
      coverage: 0,
      directionCoverage: Array(24).fill(false),
      currentDirection: 0,
      fusionKeyframes: 0,
      fusionKeyframeCompactions: 0,
      textureKeyframes: 0,
      acceptedDepthFrames: 0,
      rejectedDepthFrames: 0,
      frameQuality: "waiting",
      validDepthRatio: 0,
      movingTooFast: false,
      linearSpeed: 0,
      angularSpeed: 0,
      cameraBaseline: 0,
      cameraTravel: 0,
      nearDepthWarning: false,
      currentConfirmedRatio: 0,
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
          depthTypeRequest: ["smooth", "raw"],
          matchDepthView: true,
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
      this.pointTexture = roundPointTexture();
      const points = new THREE.Points(
        this.pointGeometry,
        new THREE.PointsMaterial({
          size: 0.018,
          vertexColors: true,
          map: this.pointTexture,
          alphaTest: 0.35,
          transparent: true,
          opacity: 0.94,
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
            this.stats.depthType = this.session.depthType || "Unavailable";
            this.stats.depthUsage = this.session.depthUsage;
            this.stats.dimensions = `${depth.width} × ${depth.height}`;
            const keyframePose = this.keyframePose(view);
            const motion = this.measureFrameMotion(keyframePose, time);
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
            // Preserve a bounded grid for mid-range phones while matching the
            // XR view aspect. Native depth storage may be rotated or cropped.
            const { columns, rows } = viewSampleGrid(view, !!colorAt);
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
            const quality = depthFrameQuality({
              validSamples: framePoints.length,
              totalSamples: columns * rows,
              nearRatio,
              ...motion,
            });
            this.stats.frameQuality = quality.reason;
            this.stats.validDepthRatio = quality.validRatio;
            this.stats.movingTooFast = quality.reason === "moving-too-fast";
            this.stats.linearSpeed = motion.linearSpeed;
            this.stats.angularSpeed = motion.angularSpeed;
            this.stats.nearDepthWarning = nearRatio > 0.12;
            if (quality.accepted) {
              this.stats.acceptedDepthFrames++;
              // Pose gating decides whether this accepted depth frame adds a
              // useful new viewpoint. Fast/sparse frames never reach fusion.
              if (keyframeEligible)
                this.captureKeyframe(
                  framePoints,
                  view,
                  columns,
                  rows,
                  time,
                  colorAt,
                  keyframePose,
                  depth,
                  motion,
                );
              // Feedback counts only views actually retained for fusion, with
              // the full image grid as denominator (including missing depth).
              this.stats.currentConfirmedRatio =
                this.cloud.confirmedRatio(framePoints, columns * rows);
            } else {
              this.stats.rejectedDepthFrames++;
              this.stats.currentConfirmedRatio = 0;
            }
            this.stats.cloudCellSize = this.cloud.size;
            this.stats.cloudCompactions = this.cloud.compactions;
            const m = view.transform.matrix;
            const direction =
              Math.floor(
                ((Math.atan2(-m[8], -m[10]) + Math.PI) / (Math.PI * 2)) * 24,
              ) % 24;
            if (quality.accepted) this.directions.add(direction);
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
    const allPoints = this.cloud.values();
    const points = allPoints.filter((point) => point.hits >= 2);
    const stride = Math.max(1, Math.ceil(points.length / 9000));
    let count = 0;
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i];
      this.positions.set([p.x, p.y, p.z], count * 3);
      // Only repeat-observed voxels stay visible. Single-hit samples are not
      // rendered because they made unconfirmed space look already scanned.
      const c = new THREE.Color("#83f2cb");
      this.colors.set([c.r, c.g, c.b], count * 3);
      count++;
    }
    this.pointGeometry.attributes.position.needsUpdate = true;
    this.pointGeometry.attributes.color.needsUpdate = true;
    this.pointGeometry.setDrawRange(0, count);
    this.stats.pointCount = allPoints.length;
    this.stats.stablePointCount = points.length;
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
  measureFrameMotion(pose, timestamp) {
    const previous = this.lastDepthPose;
    this.lastDepthPose = { pose, timestamp };
    if (!previous || timestamp <= previous.timestamp)
      return { linearSpeed: 0, angularSpeed: 0 };
    const seconds = Math.max(0.001, (timestamp - previous.timestamp) / 1000);
    const linearDistance = Math.hypot(
      pose.position.x - previous.pose.position.x,
      pose.position.y - previous.pose.position.y,
      pose.position.z - previous.pose.position.z,
    );
    const a = pose.orientation;
    const b = previous.pose.orientation;
    const dot = Math.min(
      1,
      Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w),
    );
    return {
      linearSpeed: linearDistance / seconds,
      angularSpeed: (2 * Math.acos(dot)) / seconds,
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
      if (moved < 0.08 && turned < 0.18) return false;
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
    depth = null,
    motion = {},
  ) {
    const keyframe = createRgbdKeyframe(points, {
      columns,
      rows,
      // getDepthInMeters is sampled in normalized XR-view coordinates, so the
      // grid and its reconstructed rays must use this same view geometry.
      projectionMatrix: view.projectionMatrix,
      transformMatrix: view.transform.matrix,
      viewProjectionMatrix: view.projectionMatrix,
      viewTransformMatrix: view.transform.matrix,
      geometryMode: "view-aligned-v1",
      nativeDepthWidth: depth?.width || 0,
      nativeDepthHeight: depth?.height || 0,
      nativeDepthUvTransform: depth?.normDepthBufferFromNormView?.matrix,
      camera: pose.position,
      timestamp,
      colorImage: colorAt?.snapshot?.(),
      linearSpeed: motion.linearSpeed,
      angularSpeed: motion.angularSpeed,
    });
    if (!keyframe) return;
    const capturedPositions = (this.keyframePositions ||= []);
    capturedPositions.forEach((position) => {
      this.stats.cameraBaseline = Math.max(
        this.stats.cameraBaseline,
        Math.hypot(
          pose.position.x - position.x,
          pose.position.z - position.z,
        ),
      );
    });
    const previousPosition = capturedPositions[capturedPositions.length - 1];
    if (previousPosition)
      this.stats.cameraTravel += Math.hypot(
        pose.position.x - previousPosition.x,
        pose.position.y - previousPosition.y,
        pose.position.z - previousPosition.z,
      );
    capturedPositions.push({ ...pose.position });
    // A bounded set is important on phones: the worker receives at most sixty
    // compact grids, not a growing collection of full per-frame meshes.
    const compacted = this.keyframes.length >= 60;
    if (compacted) {
      this.keyframes = this.keyframes.filter((_, index) => index % 2 === 0);
      this.stats.fusionKeyframeCompactions++;
    }
    this.keyframes.push(keyframe);
    this.compactTextureKeyframes();
    if (compacted) {
      // Previously the preview kept observations whose keyframes had been
      // discarded, falsely displaying coverage that fusion could never use.
      this.cloud = new VoxelCloud();
      this.keyframes.forEach((frame, index) => this.addSavedPreview(frame, index));
    } else this.addSavedPreview(keyframe, this.keyframes.length - 1);
    this.lastMeshPose = pose;
    this.stats.fusionKeyframes = this.keyframes.length;
  }
  compactTextureKeyframes(maximum = 24, retained = 18) {
    const textured = this.keyframes
      .map((frame, index) => (frame.colorImage?.length ? index : -1))
      .filter((index) => index >= 0);
    if (textured.length > maximum) {
      const retentionScore = (frame) => {
        const motion =
          (Number(frame.linearSpeed) || 0) / 0.55 +
          (Number(frame.angularSpeed) || 0) / 0.65;
        return imageSharpness(frame) / (1 + motion * 0.8);
      };
      const keep = new Set();
      const targetCount = Math.max(1, Math.min(retained, textured.length));
      if (targetCount === 1) {
        keep.add(
          textured.reduce((best, candidate) =>
            retentionScore(this.keyframes[candidate]) >
            retentionScore(this.keyframes[best])
              ? candidate
              : best,
          ),
        );
      } else {
        // Keep the scan endpoints, then divide the path into non-overlapping
        // temporal sectors and retain the sharpest low-motion image in each.
        // This preserves wall coverage while avoiding arbitrary blurry frames.
        keep.add(textured[0]);
        keep.add(textured[textured.length - 1]);
        const interior = textured.slice(1, -1);
        const sectors = Math.max(0, targetCount - 2);
        for (let sector = 0; sector < sectors; sector++) {
          const start = Math.floor((sector * interior.length) / sectors);
          const end = Math.floor(((sector + 1) * interior.length) / sectors);
          const candidates = interior.slice(start, Math.max(start + 1, end));
          if (!candidates.length) continue;
          keep.add(
            candidates.reduce((best, candidate) =>
              retentionScore(this.keyframes[candidate]) >
              retentionScore(this.keyframes[best])
                ? candidate
                : best,
            ),
          );
        }
      }
      textured.forEach((index) => {
        if (!keep.has(index)) this.keyframes[index].colorImage = null;
      });
    }
    this.stats.textureKeyframes = this.keyframes.reduce(
      (count, frame) => count + (frame.colorImage?.length ? 1 : 0),
      0,
    );
  }
  addSavedPreview(frame, frameId) {
    const filtered = filterDepth(frame);
    const points = [];
    filtered.measuredMask.forEach((measured, index) => {
      if (!measured) return;
      const position = depthPosition(frame, index, filtered.filtered[index]);
      if (!position?.every(Number.isFinite)) return;
      points.push({
        x: position[0], y: position[1], z: position[2],
        color: frame.colorMask[index]
          ? Array.from(frame.colors.slice(index * 3, index * 3 + 3))
          : undefined,
      });
    });
    this.cloud.add(points, frameId, frame.camera);
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
    this.pointTexture?.dispose();
    this.scene?.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) o.material.dispose();
    });
    this.renderer?.dispose();
    this.onEnd?.();
  }
}
