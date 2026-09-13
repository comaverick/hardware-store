import * as THREE from "three";
import { VoxelCloud, unprojectDepth, viewSampleGrid } from "../core/depth";
import {
  createRgbdKeyframe,
  filterDepth,
  depthPosition,
  imageFocus,
  imageSharpness,
} from "../core/fusion";
import {
  depthFrameQuality,
  MAX_COLOR_CAPTURE_ANGULAR_SPEED,
  MAX_COLOR_CAPTURE_LINEAR_SPEED,
} from "../core/readiness";
import { createCameraColorReader } from "./cameraColor";

function coverageSplatTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, 64, 64);
  const gradient = context.createRadialGradient(32, 32, 12, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.72, "rgba(255,255,255,0.96)");
  gradient.addColorStop(0.9, "rgba(255,255,255,0.64)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function coveragePreviewSize(voxelSize = 0.08) {
  return Math.max(0.09, Math.min(0.22, voxelSize * 1.5));
}

export const MAX_FUSION_KEYFRAMES = 60;
export const KEYFRAME_RETENTION_TRIGGER = 64;

function keyframePoseForRetention(frame) {
  const camera = frame?.camera;
  const matrix = frame?.transformMatrix;
  const position =
    camera?.length >= 3 &&
    [camera[0], camera[1], camera[2]].every(Number.isFinite)
      ? [camera[0], camera[1], camera[2]]
      : matrix?.length >= 15 &&
          [matrix[12], matrix[13], matrix[14]].every(Number.isFinite)
        ? [matrix[12], matrix[13], matrix[14]]
        : [0, 0, 0];
  const direction = matrix?.length >= 11
    ? [-matrix[8], -matrix[9], -matrix[10]]
    : [0, 0, -1];
  const length = Math.hypot(...direction) || 1;
  return {
    position,
    direction: direction.map((value) => value / length),
    timestamp: Number(frame?.timestamp) || 0,
  };
}

// Retain the viewpoints that provide the most spatial and directional
// coverage. Keeping every other frame is tempting, but a scan path can spend
// different amounts of time on each wall; index decimation then drops a whole
// area. This bounded farthest-point pass keeps the endpoints and fills the
// remaining slots with the least-covered poses.
export function selectKeyframesForRetention(
  frames,
  maximum = MAX_FUSION_KEYFRAMES,
) {
  if (!Array.isArray(frames) || frames.length <= maximum) return frames?.slice() || [];
  const limit = Math.max(2, Math.floor(maximum));
  if (limit >= frames.length) return frames.slice();
  const poses = frames.map(keyframePoseForRetention);
  const timestamps = poses.map((pose, index) => pose.timestamp || index);
  const timestampSpan = Math.max(1, timestamps[timestamps.length - 1] - timestamps[0]);
  const selected = new Set([0, frames.length - 1]);
  while (selected.size < limit) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let candidate = 0; candidate < frames.length; candidate++) {
      if (selected.has(candidate)) continue;
      let score = Infinity;
      selected.forEach((chosen) => {
        const a = poses[candidate];
        const b = poses[chosen];
        const spatial = Math.hypot(
          a.position[0] - b.position[0],
          a.position[1] - b.position[1],
          a.position[2] - b.position[2],
        );
        const directionDot = Math.max(
          -1,
          Math.min(
            1,
            a.direction[0] * b.direction[0] +
              a.direction[1] * b.direction[1] +
              a.direction[2] * b.direction[2],
          ),
        );
        const angular = Math.acos(directionDot);
        const temporal =
          Math.abs(timestamps[candidate] - timestamps[chosen]) / timestampSpan;
        score = Math.min(score, spatial + angular * 0.18 + temporal * 0.01);
      });
      if (score > bestScore) {
        bestScore = score;
        bestIndex = candidate;
      }
    }
    if (bestIndex < 0) break;
    selected.add(bestIndex);
  }
  // The fallback matters only when all poses are identical and the novelty
  // score ties. It still gives callers exactly the requested bounded count.
  for (let index = 0; selected.size < limit && index < frames.length; index++)
    selected.add(index);
  return [...selected]
    .sort((left, right) => left - right)
    .slice(0, limit)
    .map((index) => frames[index]);
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
      depthState: "waiting",
      depthMisses: 0,
      depthReadErrors: 0,
      originChanged: false,
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
      colorSharpness: 0,
      colorClippedRatio: 0,
      colorFrameReliable: true,
      colorFramesSkippedForMotion: 0,
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
      poseDriftWarning: false,
      rejectedPoseFrames: 0,
      poseOverlapRatio: 0,
      poseMedianResidual: 0,
      poseUpperResidual: 0,
      captureError: "",
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
        // A depth-less AR session cannot produce a ScanSpace scan. Require the
        // feature so unsupported sessions fail immediately instead of showing
        // "No reliable depth" forever after the camera opens.
        requiredFeatures: ["hit-test", "depth-sensing"],
        optionalFeatures: [
          "local-floor",
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
      this.stats.depthUsage = this.session.depthUsage || "Unavailable";
      this.stats.depthType = this.session.depthType || "Unavailable";
      const depthEnabled = this.stats.features.includes("depth-sensing");
      if (!depthEnabled || this.session.depthUsage !== "cpu-optimized") {
        this.stats.depthState = "unavailable";
        throw new Error(
          "This device did not grant CPU depth sensing. Use a supported Android browser and allow camera/depth access.",
        );
      }
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
        this.stats.originChanged = true;
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
      this.pointTexture = coverageSplatTexture();
      this.coverageMaterial = new THREE.PointsMaterial({
        size: coveragePreviewSize(this.cloud.size),
        sizeAttenuation: true,
        vertexColors: true,
        map: this.pointTexture,
        alphaTest: 0.01,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        toneMapped: false,
      });
      const points = new THREE.Points(this.pointGeometry, this.coverageMaterial);
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
  recordCaptureError(error, prefix = "Capture error") {
    const message = `${prefix}: ${error?.message || String(error)}`;
    this.stats.captureError = message;
    if (this.stats.errors[this.stats.errors.length - 1] !== message)
      this.stats.errors = [...this.stats.errors.slice(-4), message];
  }
  markDepthMiss(time) {
    this.stats.depthMisses++;
    if (!this.stats.depthActive) {
      this.stats.depthState = this.stats.depthMisses >= 5 ? "stalled" : "waiting";
      this.stats.frameQuality = "waiting";
    } else {
      const age = this.lastDepthAt ? time - this.lastDepthAt : Infinity;
      this.stats.depthState = age > 2000 ? "stalled" : "waiting";
    }
  }
  captureDepthFrame(time, frame, view) {
    let depth = null;
    try {
      const depthUsage = this.session?.depthUsage || this.stats.depthUsage;
      if (
        depthUsage === "cpu-optimized" &&
        typeof frame.getDepthInformation === "function"
      )
        depth = frame.getDepthInformation(view);
    } catch (error) {
      this.stats.rejectedDepthFrames++;
      this.stats.depthReadErrors++;
      this.stats.depthState = "error";
      this.recordCaptureError(error, "Depth read failed");
      return;
    }
    if (!depth) {
      this.markDepthMiss(time);
      return;
    }
    this.lastDepthAt = time;
    this.stats.depthMisses = 0;
    this.stats.depthState = "active";
    this.stats.depthFrames++;
    this.stats.depthActive = true;
    this.stats.format = this.session.depthDataFormat || "Unavailable";
    this.stats.depthType = this.session.depthType || "Unavailable";
    this.stats.depthUsage = this.session.depthUsage || "Unavailable";
    this.stats.dimensions = `${depth.width} × ${depth.height}`;
    try {
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
          if (colorAt) {
            this.stats.colorActive = true;
            this.stats.colorSharpness = colorAt.sharpness || 0;
            this.stats.colorClippedRatio = colorAt.clippedRatio || 0;
          }
        } catch (error) {
          this.colorFailures = (this.colorFailures || 0) + 1;
          this.colorFailed = this.colorFailures >= 3;
          this.recordCaptureError(error, "Captured color unavailable");
        } finally {
          this.renderer.resetState();
        }
      }
      // Preserve a bounded grid for mid-range phones while matching the XR
      // view aspect. Native depth storage may be rotated or cropped.
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
      const obstructionPointCount = framePoints.reduce(
        (count, point) => count + (point.depth < 0.52 ? 1 : 0),
        0,
      );
      const nearRatio = framePoints.length
        ? nearPointCount / framePoints.length
        : 0;
      const obstructionRatio = framePoints.length
        ? obstructionPointCount / framePoints.length
        : 0;
      const quality = depthFrameQuality({
        validSamples: framePoints.length,
        totalSamples: columns * rows,
        obstructionRatio,
        ...motion,
      });
      this.stats.frameQuality = quality.reason;
      this.stats.validDepthRatio = quality.validRatio;
      this.stats.movingTooFast = quality.reason === "moving-too-fast";
      this.stats.linearSpeed = motion.linearSpeed;
      this.stats.angularSpeed = motion.angularSpeed;
      this.stats.nearDepthWarning = nearRatio > 0.12;
      this.stats.poseDriftWarning = false;
      if (quality.accepted) {
        this.stats.acceptedDepthFrames++;
        const consistency = keyframeEligible
          ? this.cloud.overlapConsistency(framePoints)
          : null;
        this.stats.poseOverlapRatio = consistency?.overlapRatio || 0;
        this.stats.poseMedianResidual = consistency?.medianDistance || 0;
        this.stats.poseUpperResidual = consistency?.upperDistance || 0;
        if (keyframeEligible && this.shouldRejectPose(consistency, keyframePose)) {
          this.stats.rejectedDepthFrames++;
          this.stats.rejectedPoseFrames++;
          this.stats.poseDriftWarning = true;
          this.stats.frameQuality = "pose-inconsistent";
          this.stats.currentConfirmedRatio = 0;
        } else {
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
        }
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
      if (quality.accepted && !this.stats.poseDriftWarning)
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
    } catch (error) {
      // A single malformed depth texture must not turn the whole XR session
      // into a permanent paused state. The next frame can often recover.
      this.stats.rejectedDepthFrames++;
      this.stats.depthReadErrors++;
      this.stats.depthState = "error";
      this.stats.frameQuality = "depth-error";
      this.stats.currentConfirmedRatio = 0;
      this.recordCaptureError(error, "Depth frame skipped");
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
          this.captureDepthFrame(time, frame, view);
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
      this.recordCaptureError(error, "Capture paused after an XR error");
      this.publish();
    }
  }
  updatePreview() {
    const allPoints = this.cloud.values();
    const points = allPoints.filter((point) => point.hits >= 2);
    const stride = Math.max(1, Math.ceil(points.length / 12000));
    if (this.coverageMaterial)
      this.coverageMaterial.size = coveragePreviewSize(this.cloud.size);
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
      // Keep nearby translated views so the fusion volume gets real overlap
      // instead of long, sparsely supported jumps that bend wall edges.
      if (moved < 0.055 && turned < 0.12) return false;
    }
    return true;
  }
  shouldRejectPose(consistency, pose) {
    if (
      !consistency ||
      consistency.compared < 80 ||
      consistency.overlapRatio < 0.3 ||
      !Number.isFinite(consistency.medianDistance) ||
      !Number.isFinite(consistency.upperDistance)
    )
      return false;
    const moved = this.lastMeshPose
      ? Math.hypot(
          pose.position.x - this.lastMeshPose.position.x,
          pose.position.y - this.lastMeshPose.position.y,
          pose.position.z - this.lastMeshPose.position.z,
        )
      : 0;
    // A genuinely new area can be far from the previous cloud. Only reject a
    // nearby view whose overlapping geometry has shifted into a second layer.
    if (moved > 0.35) return false;
    return consistency.medianDistance > 0.06 && consistency.upperDistance > 0.095;
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
    const colorFrameReliable =
      (Number(motion.linearSpeed) || 0) <=
        MAX_COLOR_CAPTURE_LINEAR_SPEED &&
      (Number(motion.angularSpeed) || 0) <=
        MAX_COLOR_CAPTURE_ANGULAR_SPEED;
    const keepColor = !colorAt || colorFrameReliable;
    const colorSnapshot = keepColor ? colorAt?.snapshot?.() || null : null;
    this.stats.colorFrameReliable = !colorAt || colorFrameReliable;
    if (colorAt && !colorFrameReliable)
      this.stats.colorFramesSkippedForMotion++;
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
      colorImage: colorSnapshot,
      keepColor,
      colorSharpness:
        Number(colorAt?.sharpness ?? colorSnapshot?.sharpness) || 0,
      colorClippedRatio:
        Number(colorAt?.clippedRatio ?? colorSnapshot?.clippedRatio) || 0,
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
    // Keep a small memory cushion so retention runs only every few frames,
    // while never throwing away half of a scan path at once.
    const pending = [...this.keyframes, keyframe];
    const compacted = pending.length > KEYFRAME_RETENTION_TRIGGER;
    this.keyframes = compacted
      ? selectKeyframesForRetention(pending, MAX_FUSION_KEYFRAMES)
      : pending;
    if (compacted) this.stats.fusionKeyframeCompactions++;
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
  // Keep the atlas below the portable-export and mobile-GPU limits. With the
  // higher-detail 720px snapshots, twenty portrait tiles still fit while a
  // fifth atlas row would make exports unnecessarily large.
  compactTextureKeyframes(maximum = 20, retained = 18) {
    const textured = this.keyframes
      .map((frame, index) => (frame.colorImage?.length ? index : -1))
      .filter((index) => index >= 0);
    if (textured.length > maximum) {
      const retentionScore = (frame) => {
        const motion =
          (Number(frame.linearSpeed) || 0) / 0.55 +
          (Number(frame.angularSpeed) || 0) / 0.65;
        const sharpness = imageSharpness(frame);
        const focus = imageFocus(frame);
        const clipping = Math.min(
          0.75,
          Math.max(0, Number(frame.colorClippedRatio) || 0),
        );
        return (
          (sharpness * Math.sqrt(Math.max(0.5, focus)) * (1 - clipping)) /
          (1 + motion * 1.05)
        );
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
        // Divide the entire path into temporal sectors and keep each sector's
        // sharpest low-motion image. Forcing the first and last images kept
        // autofocus/motion failures even when a clear neighbor saw the same
        // area.
        const sectors = targetCount;
        for (let sector = 0; sector < sectors; sector++) {
          const start = Math.floor((sector * textured.length) / sectors);
          const end = Math.floor(((sector + 1) * textured.length) / sectors);
          const candidates = textured.slice(start, Math.max(start + 1, end));
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
