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
import { AdaptiveCapture, adaptiveCaptureProfile, captureDetail, capturePointObserved, confirmedViewRatio, prepareCaptureFrame } from "../core/adaptiveCapture";

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
export const MAX_TEXTURE_KEYFRAMES = 15;
export const DEPTH_TYPE_PREFERENCE = Object.freeze(["raw", "smooth"]);

function poseMotion(previous, pose, timestamp) {
  if (!previous || timestamp <= previous.timestamp)
    return { linearSpeed: 0, angularSpeed: 0 };
  const seconds = Math.max(0.001, (timestamp - previous.timestamp) / 1000);
  const a = pose.orientation;
  const b = previous.pose.orientation;
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return {
    linearSpeed: Math.hypot(
      pose.position.x - previous.pose.position.x,
      pose.position.y - previous.pose.position.y,
      pose.position.z - previous.pose.position.z,
    ) / seconds,
    angularSpeed: (2 * Math.acos(dot)) / seconds,
  };
}

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

function textureKeyframePoseForRetention(frame) {
  const camera = frame?.camera;
  const matrix =
    frame?.viewTransformMatrix?.length === 16
      ? frame.viewTransformMatrix
      : frame?.transformMatrix;
  const position =
    matrix?.length >= 15 &&
    [matrix[12], matrix[13], matrix[14]].every(Number.isFinite)
      ? [matrix[12], matrix[13], matrix[14]]
      : camera?.length >= 3 &&
          [camera[0], camera[1], camera[2]].every(Number.isFinite)
        ? [camera[0], camera[1], camera[2]]
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

function qualityForRetention(frames, index) {
  const frame = frames[index];
  const measured = Number(frame?.measuredDepthCount);
  const valid = Number(frame?.validCount);
  return Number.isFinite(measured)
    ? measured
    : Number.isFinite(valid)
      ? valid
      : 0;
}

function textureQualityScore(frame) {
  const storedSharpness = Number(frame?.colorSharpness) || 0;
  const storedFocus = Number(frame?.colorFocus) || 0;
  const sharpness = storedSharpness || imageSharpness(frame);
  const focus = storedFocus || imageFocus(frame);
  const clipping = Math.min(
    0.8,
    Math.max(0, Number(frame?.colorClippedRatio) || 0),
  );
  const motion =
    (Number(frame?.textureLinearSpeed ?? frame?.linearSpeed) || 0) /
      MAX_COLOR_CAPTURE_LINEAR_SPEED +
    (Number(frame?.textureAngularSpeed ?? frame?.angularSpeed) || 0) /
      MAX_COLOR_CAPTURE_ANGULAR_SPEED;
  return (
    (sharpness * Math.sqrt(Math.max(0.1, focus)) * (1 - clipping)) /
    (1 + motion)
  );
}

function texturePoseDistance(left, right) {
  const spatial = Math.hypot(
    left.position[0] - right.position[0],
    left.position[1] - right.position[1],
    left.position[2] - right.position[2],
  );
  const dot = Math.max(
    -1,
    Math.min(
      1,
      left.direction[0] * right.direction[0] +
        left.direction[1] * right.direction[1] +
        left.direction[2] * right.direction[2],
    ),
  );
  const angular = Math.acos(dot);
  // Twelve centimetres or about twelve degrees are both meaningful texture
  // viewpoint changes. Normalize them to the same retention scale.
  return Math.hypot(spatial / 0.12, angular / 0.21);
}

// Continuously remove the most redundant texture view instead of dividing the
// history into fixed time buckets. A later view of a new wall or ceiling then
// displaces an older duplicate, while a sharper view wins between near-equal
// poses. Depth keyframes are never removed by this texture-only selection.
export function selectTextureKeyframesForRetention(
  frames,
  maximum = MAX_TEXTURE_KEYFRAMES,
) {
  const textured = (frames || [])
    .map((frame, index) => (frame?.colorImage?.length ? index : -1))
    .filter((index) => index >= 0);
  const limit = Math.max(1, Math.floor(maximum));
  if (textured.length <= limit) return textured;
  const poses = new Map(
    textured.map((index) => [
      index,
      textureKeyframePoseForRetention(frames[index]),
    ]),
  );
  const qualities = new Map(
    textured.map((index) => [index, textureQualityScore(frames[index])]),
  );
  const rankedQuality = [...qualities.values()].sort((a, b) => a - b);
  const referenceQuality =
    rankedQuality[Math.floor(rankedQuality.length / 2)] || 1;
  const retained = textured.slice();
  while (retained.length > limit) {
    let removePosition = 0;
    let lowestUtility = Infinity;
    let lowestQuality = Infinity;
    retained.forEach((index, position) => {
      let nearest = Infinity;
      retained.forEach((other) => {
        if (other === index) return;
        nearest = Math.min(
          nearest,
          texturePoseDistance(poses.get(index), poses.get(other)),
        );
      });
      const normalizedQuality = Math.max(
        0,
        Math.min(3, qualities.get(index) / referenceQuality),
      );
      const utility = Math.min(4, nearest) + normalizedQuality * 0.35;
      const quality = qualities.get(index);
      if (
        utility < lowestUtility - 1e-6 ||
        (Math.abs(utility - lowestUtility) <= 1e-6 &&
          quality < lowestQuality)
      ) {
        lowestUtility = utility;
        lowestQuality = quality;
        removePosition = position;
      }
    });
    retained.splice(removePosition, 1);
  }
  return retained.sort((left, right) => left - right);
}

// Retain a temporally even path of viewpoints. A farthest-point pass looks
// attractive for coverage, but it can keep two distant poses and discard all
// of the overlapping frames between them. That turns a continuous wall into
// unsupported TSDF spans and is a common cause of bowed or doubled edges.
// Texture views remain pinned first; the remaining depth slots are filled by
// samples distributed across the whole capture timeline, with depth quality
// breaking ties. This keeps nearby overlap without adding a user-facing scan
// restriction.
export function selectKeyframesForRetention(
  frames,
  maximum = MAX_FUSION_KEYFRAMES,
) {
  if (!Array.isArray(frames) || frames.length <= maximum) return frames?.slice() || [];
  const limit = Math.max(2, Math.floor(maximum));
  if (limit >= frames.length) return frames.slice();
  // Texture retention has already reduced live captures to a small,
  // pose-diverse set. Seed geometry compaction with those frames so the
  // 60-frame worker bound cannot silently discard the only color view of a
  // wall or ceiling. Oversized imported/debug sets are reduced with the same
  // texture selector before the remaining slots are filled by depth novelty.
  const textured = frames
    .map((frame, index) => (frame?.colorImage?.length ? index : -1))
    .filter((index) => index >= 0);
  const selected = new Set(
    textured.length <= limit
      ? textured
      : selectTextureKeyframesForRetention(frames, limit),
  );
  // Pin both ends of the path, then choose the closest unselected frame to
  // each evenly spaced timeline target. If a target lands on an already
  // pinned texture frame, the next closest depth frame is used instead. The
  // quality tie-break keeps a clearer revisit without moving it far from its
  // original temporal slot.
  selected.add(0);
  selected.add(frames.length - 1);
  if (selected.size > limit) {
    const pinned = [0, frames.length - 1];
    selected.clear();
    pinned.forEach((index) => selected.add(index));
    textured
      .slice()
      .sort((left, right) => qualityForRetention(frames, right) - qualityForRetention(frames, left))
      .forEach((index) => {
        if (selected.size < limit) selected.add(index);
      });
  }
  const quality = (index) => qualityForRetention(frames, index);
  for (let slot = 0; selected.size < limit && slot < limit; slot++) {
    const target = (slot * (frames.length - 1)) / Math.max(1, limit - 1);
    let bestIndex = -1;
    let bestDistance = Infinity;
    let bestQuality = -Infinity;
    for (let candidate = 0; candidate < frames.length; candidate++) {
      if (selected.has(candidate)) continue;
      const distance = Math.abs(candidate - target);
      const candidateQuality = quality(candidate);
      if (
        distance < bestDistance - 1e-6 ||
        (Math.abs(distance - bestDistance) <= 1e-6 &&
          candidateQuality > bestQuality)
      ) {
        bestIndex = candidate;
        bestDistance = distance;
        bestQuality = candidateQuality;
      }
    }
    if (bestIndex < 0) break;
    selected.add(bestIndex);
  }
  // A malformed timestamp/path must still return exactly the requested
  // bounded count; the caller can then apply its normal overlap validation.
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
      independentTextureCaptures: 0,
      colorSharpness: 0,
      colorFocus: 0,
      colorClippedRatio: 0,
      colorFrameReliable: true,
      colorFramesSkippedForMotion: 0,
      textureRefreshes: 0,
      depthRefreshes: 0,
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
    this.capture = new AdaptiveCapture({ maximumFrames: MAX_FUSION_KEYFRAMES });
    this.captureProfile = adaptiveCaptureProfile();
    this.captureProcessingMs = 0;
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
          // Raw depth preserves real wall/ceiling boundaries. Smooth depth is
          // still accepted as a fallback for devices that expose only it.
          depthTypeRequest: DEPTH_TYPE_PREFERENCE,
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
        this.capture.failure("tracking-reset", performance.now());
        this.updateAdaptiveStats();
        if (this.recoveryMarker) this.recoveryMarker.visible = false;
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
      this.recoveryMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 12, 8),
        new THREE.MeshBasicMaterial({ color: "#ffc47b", transparent: true, opacity: 0.85, depthWrite: false }),
      );
      this.recoveryMarker.visible = false;
      this.scene.add(this.recoveryMarker);
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
    const started = performance.now();
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
      this.stats.currentConfirmedRatio = 0;
      this.recordCaptureError(error, "Depth read failed");
      this.capture.failure("depth-error", time);
      this.updateAdaptiveStats();
      return;
    }
    if (!depth) {
      this.markDepthMiss(time);
      this.stats.currentConfirmedRatio = 0;
      if (time - (this.lastDepthAt ?? time) > 1800) this.capture.failure("depth-missing", time);
      this.updateAdaptiveStats();
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
    this.nativeDepthSize = { width: depth.width, height: depth.height };
    try {
      const keyframePose = this.keyframePose(view);
      const motion = this.measureFrameMotion(keyframePose, time);
      if (this.cameraMotion?.timestamp === time) {
        motion.textureLinearSpeed = this.cameraMotion.linearSpeed;
        motion.textureAngularSpeed = this.cameraMotion.angularSpeed;
      }
      this.captureProfile = adaptiveCaptureProfile({
        depthType: this.stats.depthType, width: depth.width, height: depth.height,
        validRatio: this.stats.depthFrames > 1 ? this.stats.validDepthRatio : 1, ...this.captureDetail,
        processingMs: this.captureProcessingMs, ...this.cameraMotion,
      });
      let colorAt = null;
      if (
        this.binding &&
        view.camera &&
        time >= (this.colorRetryAt || 0) && time - (this.lastColorReadAt ?? -Infinity) >= 350
      ) {
        try {
          this.colorReader ??= createCameraColorReader(
            this.renderer.getContext(),
          );
          this.lastColorReadAt = time;
          colorAt = this.colorReader.read(this.binding, view.camera);
          if (colorAt) {
            this.stats.colorActive = true;
            this.stats.colorSharpness = colorAt.sharpness || 0;
            this.stats.colorFocus = colorAt.focus || 0;
            this.stats.colorClippedRatio = colorAt.clippedRatio || 0;
            this.stats.colorFrameReliable =
              this.isColorFrameReliable(motion, colorAt);
            if (!this.stats.colorFrameReliable) this.stats.colorFramesSkippedForMotion++;
            this.colorFailures = 0;
          }
        } catch (error) {
          this.colorFailures = (this.colorFailures || 0) + 1;
          // Camera textures are frame-scoped and can fail transiently during
          // tracking changes. Back off briefly, then recover automatically
          // instead of turning the rest of the scan permanently gray.
          this.colorRetryAt =
            time + Math.min(2000, 250 * 2 ** (this.colorFailures - 1));
          this.recordCaptureError(error, "Captured color unavailable");
        } finally {
          this.renderer.resetState();
        }
      }
      // Preserve a bounded grid for mid-range phones while matching the XR
      // view aspect. Native depth storage may be rotated or cropped.
      const { columns, rows } = viewSampleGrid(view, !!colorAt, this.captureProfile.sampleLongSide);
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
        // Use the short XR motion window too: a fast out-and-back movement
        // can look stationary between two sampled depth frames.
        linearSpeed: Math.max(motion.linearSpeed, motion.textureLinearSpeed || 0),
        angularSpeed: Math.max(motion.angularSpeed, motion.textureAngularSpeed || 0),
        maxLinearSpeed: this.captureProfile.maxLinearSpeed,
        maxAngularSpeed: this.captureProfile.maxAngularSpeed,
      });
      this.stats.frameQuality = quality.reason;
      this.stats.validDepthRatio = quality.validRatio;
      this.stats.movingTooFast = quality.reason === "moving-too-fast";
      this.stats.linearSpeed = motion.linearSpeed;
      this.stats.angularSpeed = motion.angularSpeed;
      this.stats.nearDepthWarning = nearRatio > 0.12;
      this.stats.poseDriftWarning = false;
      if (quality.accepted) {
        const candidate = createRgbdKeyframe(framePoints, {
          columns, rows, timestamp: time, camera: keyframePose.position,
          projectionMatrix: view.projectionMatrix, transformMatrix: view.transform.matrix,
          viewProjectionMatrix: view.projectionMatrix, viewTransformMatrix: view.transform.matrix,
          geometryMode: "view-aligned-v1", keepColor: !!colorAt,
          nativeDepthWidth: depth.width, nativeDepthHeight: depth.height,
          nativeDepthUvTransform: depth.normDepthBufferFromNormView?.matrix,
          depthType: this.stats.depthType, linearSpeed: motion.linearSpeed, angularSpeed: motion.angularSpeed,
        });
        if (!candidate) return;
        candidate.measuredDepthCount = prepareCaptureFrame(candidate).measuredCount;
        candidate.depthQuality = candidate.measuredDepthCount;
        this.captureDetail = captureDetail(candidate);
        const previousFrames = this.keyframes.slice();
        const decision = this.capture.consider(candidate, this.captureProfile);
        this.keyframes = this.capture.frames;
        const match = this.capture.lastMatch;
        this.stats.poseOverlapRatio = match?.overlap || 0;
        this.stats.poseMedianResidual = Number.isFinite(match?.median) ? match.median : 0;
        this.stats.poseUpperResidual = Number.isFinite(match?.upper) ? match.upper : 0;
        this.stats.frameQuality = decision.reason;
        if (!decision.accepted) {
          this.stats.rejectedDepthFrames++;
          if (decision.reason === "alignment-conflict") this.stats.rejectedPoseFrames++;
          this.stats.poseDriftWarning = this.capture.state === "recovering";
          this.stats.currentConfirmedRatio = 0;
        } else {
          this.stats.acceptedDepthFrames++;
          this.keyframes = this.capture.frames;
          if (decision.committed.length) {
            if (previousFrames.some(saved => !this.keyframes.includes(saved))) this.rebuildPreviewCloud();
            else decision.committed.forEach(saved => this.addSavedPreview(saved, saved.captureId));
            this.recordCommittedViews(decision.committed);
            this.lastMeshPose = keyframePose;
          }
          // Retain RGB with its OWN same-frame depth and camera pose, even
          // between geometry keyframes. These observations never enter TSDF
          // fusion or the confirmed-coverage preview.
          this.captureTextureObservation(framePoints, view, columns, rows,
            time, colorAt, keyframePose, depth, motion);
          // Pose gating decides whether this accepted depth frame adds a
          // useful new viewpoint. Fast/sparse frames never reach fusion.
          if (!decision.committed.length) {
            // A stationary revisit may contain a better depth sample even
            // though it is not a new independent viewpoint. Replace only the
            // nearby keyframe when its measured support is materially better;
            // texture refresh remains a separate decision below.
            this.refreshNearbyDepthKeyframe(
              framePoints,
              view,
              columns,
              rows,
              time,
              keyframePose,
              depth,
              motion,
            );
            if (!this.textureKeyframes?.length) this.refreshNearbyTextureKeyframe(
              colorAt,
              keyframePose,
              view,
              motion,
              time,
            );
          }
          // Feedback counts only views actually retained for fusion, with
          // the full image grid as denominator (including missing depth).
          this.stats.currentConfirmedRatio =
            confirmedViewRatio(candidate, this.capture.references(candidate));
        }
      } else {
        this.stats.rejectedDepthFrames++;
        this.stats.currentConfirmedRatio = 0;
        this.capture.failure(quality.reason, time);
      }
      this.updateAdaptiveStats();
      this.stats.cloudCellSize = this.cloud.size;
      this.stats.cloudCompactions = this.cloud.compactions;
      const m = view.transform.matrix;
      const direction =
        Math.floor(
          ((Math.atan2(-m[8], -m[10]) + Math.PI) / (Math.PI * 2)) * 24,
        ) % 24;
      if (quality.accepted && this.capture.state === "tracking" && this.stats.frameQuality === "connected")
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
      this.capture.failure("depth-error", time);
      this.updateAdaptiveStats();
    } finally {
      const elapsed = performance.now() - started;
      this.captureProcessingMs = this.captureProcessingMs ? this.captureProcessingMs * 0.8 + elapsed * 0.2 : elapsed;
      this.stats.captureProcessingMs = Math.round(this.captureProcessingMs);
    }
  }
  frame(time, frame) {
    if (!frame || this.closed) return;
    try {
      const pose = frame.getViewerPose(this.space);
      this.stats.tracking = !!pose && !pose.emulatedPosition;
      this.hit = null;
      if (pose && !pose.emulatedPosition) {
        const view = pose.views[0];
        if (view) this.recordCameraMotion(this.keyframePose(view), time);
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
        const interval = adaptiveCaptureProfile({ ...this.captureDetail,
          ...this.nativeDepthSize, validRatio: this.stats.depthFrames ? this.stats.validDepthRatio : 1,
          depthType: this.stats.depthType, processingMs: this.captureProcessingMs,
          linearSpeed: this.cameraMotion?.linearSpeed || 0, angularSpeed: this.cameraMotion?.angularSpeed || 0,
        }).interval;
        this.stats.captureIntervalMs = interval;
        if (!this.paused && view && time - (this.lastCapture || 0) >= interval) {
          this.lastCapture = time;
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
      } else {
        this.capture.failure("tracking-lost", time);
        this.updateAdaptiveStats();
        this.lastCameraPose = null;
        this.cameraMotion = null;
        this.cameraMotionWindow = [];
        this.stats.currentConfirmedRatio = 0;
      }
      if (time - (this.lastPublish || 0) > 350) {
        this.stats.depthCurrent =
          !!this.lastDepthAt && time - this.lastDepthAt < 2000;
        this.lastPublish = time;
        this.updatePreview();
        this.publish();
      }
      if (pose && this.stats.tracking) this.updateRecoveryTarget(pose.views[0]);
      else if (this.recoveryMarker) this.recoveryMarker.visible = false;
      if (this.coverageMaterial) this.coverageMaterial.visible = this.stats.tracking && !this.originChanged;
      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      this.paused = true;
      this.recordCaptureError(error, "Capture paused after an XR error");
      this.publish();
    }
  }
  updateAdaptiveStats() {
    this.stats.adaptiveCapture = this.capture.snapshot();
    this.stats.captureProfile = this.captureProfile.name;
    this.stats.fusionKeyframes = this.keyframes.length;
    this.stats.fusionKeyframeCompactions = this.capture.events.removed;
    this.stats.connectedSurfaceCoverage = Math.round(this.stats.adaptiveCapture.coverage.ratio * 100);
  }
  recordCommittedViews(frames) {
    const positions = (this.keyframePositions ||= []);
    for (const frame of frames) {
      const position = { x: frame.camera[0], y: frame.camera[1], z: frame.camera[2] };
      for (const previous of positions) this.stats.cameraBaseline = Math.max(this.stats.cameraBaseline,
        Math.hypot(position.x - previous.x, position.z - previous.z));
      const last = positions[positions.length - 1];
      if (last) this.stats.cameraTravel += Math.hypot(position.x - last.x, position.y - last.y, position.z - last.z);
      positions.push(position);
    }
    // Geometry stays bounded, so auxiliary motion history must be bounded too.
    if (positions.length > 128) positions.splice(0, positions.length - 128);
  }
  updateRecoveryTarget(view) {
    if (!this.recoveryMarker || !view) return;
    const recovering = this.capture.state === "recovering";
    let target = this.stats.adaptiveCapture?.coverage.target;
    if (recovering) {
      const last = this.keyframes[this.keyframes.length - 1];
      if (last) {
        const valid = prepareCaptureFrame(last);
        const center = Math.floor(last.rows / 2) * last.columns + Math.floor(last.columns / 2);
        const index = valid.measuredMask[center] ? center : valid.measuredMask.findIndex(Boolean);
        if (index >= 0) target = Array.from(valid.positions.subarray(index * 3, index * 3 + 3));
      }
    }
    this.recoveryMarker.visible = !!target && !this.originChanged && this.stats.tracking && !this.paused;
    if (!this.recoveryMarker.visible) return;
    this.recoveryMarker.position.fromArray(target);
    const local = new THREE.Vector3().fromArray(target).applyMatrix4(new THREE.Matrix4().fromArray(view.transform.matrix).invert());
    this.stats.recoveryDirection = local.z > 0 ? "Turn back toward the last scanned area" :
      Math.abs(local.x) > Math.abs(local.z) * 0.3 ? (local.x > 0 ? "Turn gently right toward the amber marker" : "Turn gently left toward the amber marker") :
      Math.abs(local.y) > Math.abs(local.z) * 0.3 ? (local.y > 0 ? "Aim up toward the amber marker" : "Aim down toward the amber marker") : "Keep the amber area in view while moving gently sideways";
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
    return poseMotion(previous, pose, timestamp);
  }
  recordCameraMotion(pose, timestamp) {
    // Sampled depth alone aliases hand shake: moving away and back can appear
    // stationary. Track every XR view and use the recent motion peak for both
    // depth acceptance and texture quality, without requiring a full stop.
    const motion = poseMotion(this.lastCameraPose, pose, timestamp);
    this.lastCameraPose = { pose, timestamp };
    this.cameraMotionWindow = (this.cameraMotionWindow || []).filter(
      (sample) => sample.timestamp > timestamp - 100 && sample.timestamp < timestamp,
    );
    this.cameraMotionWindow.push({ ...motion, timestamp });
    this.cameraMotion = {
      timestamp,
      linearSpeed: Math.max(...this.cameraMotionWindow.map((sample) => sample.linearSpeed)),
      angularSpeed: Math.max(...this.cameraMotionWindow.map((sample) => sample.angularSpeed)),
    };
    return this.cameraMotion;
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
      if (moved < this.captureProfile.spacing && turned < this.captureProfile.turn) return false;
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
  isColorFrameReliable(motion = {}, colorAt = null) {
    const settled = (
      (Number(motion.textureLinearSpeed ?? motion.linearSpeed) || 0) <=
        MAX_COLOR_CAPTURE_LINEAR_SPEED &&
      (Number(motion.textureAngularSpeed ?? motion.angularSpeed) || 0) <=
        MAX_COLOR_CAPTURE_ANGULAR_SPEED
    );
    // Speed is a proxy for blur, not a measurement of it. A well-focused
    // exposure during a slow sweep can be useful; fast/tracking jumps cannot.
    return settled || (!!colorAt?.quality?.samples &&
      colorAt.quality.samples >= 64 && colorAt.focus >= 2.5 &&
      colorAt.sharpness >= 6 && colorAt.clippedRatio < 0.2 &&
      (Number(motion.textureLinearSpeed ?? motion.linearSpeed) || 0) <= 0.45 &&
      (Number(motion.textureAngularSpeed ?? motion.angularSpeed) || 0) <= 0.6);
  }
  captureTextureObservation(points, view, columns, rows, timestamp, colorAt,
    pose, depth = null, motion = {}) {
    if (!colorAt?.snapshot || !this.isColorFrameReliable(motion, colorAt) ||
        timestamp - (this.lastTextureCandidateAt ?? -Infinity) < 200) return false;
    this.lastTextureCandidateAt = timestamp;
    const candidatePose = textureKeyframePoseForRetention({ viewTransformMatrix: view.transform.matrix });
    const pool = this.textureKeyframes || [];
    const quality = {
      colorSharpness: colorAt.sharpness, colorFocus: colorAt.focus,
      colorClippedRatio: colorAt.clippedRatio,
      textureLinearSpeed: motion.textureLinearSpeed ?? motion.linearSpeed,
      textureAngularSpeed: motion.textureAngularSpeed ?? motion.angularSpeed,
    };
    const nearby = pool.findIndex((frame) =>
      texturePoseDistance(candidatePose, textureKeyframePoseForRetention(frame)) < 0.4);
    if (nearby >= 0 && textureQualityScore(quality) <= textureQualityScore(pool[nearby]) * 1.08)
      return false;
    const snapshot = colorAt.snapshot();
    if (!snapshot?.data?.length) return false;
    const candidate = createRgbdKeyframe(points, {
      columns, rows, timestamp, camera: pose.position,
      projectionMatrix: view.projectionMatrix, transformMatrix: view.transform.matrix,
      viewProjectionMatrix: view.projectionMatrix, viewTransformMatrix: view.transform.matrix,
      geometryMode: "view-aligned-v1", keepColor: true, colorImage: snapshot,
      nativeDepthWidth: depth?.width || 0, nativeDepthHeight: depth?.height || 0,
      nativeDepthUvTransform: depth?.normDepthBufferFromNormView?.matrix,
      depthType: this.stats.depthType,
      ...quality,
    });
    if (!candidate) return false;
    Object.assign(candidate, quality, { textureOnly: true });
    if (nearby >= 0) pool.splice(nearby, 1, candidate);
    else pool.push(candidate);
    this.textureKeyframes = pool;
    // Legacy depth frames can still own photos (restored diagnostic captures).
    // Compact the union, never allocate a second unbounded image collection.
    this.compactTextureKeyframes();
    this.stats.independentTextureCaptures = (this.stats.independentTextureCaptures || 0) + 1;
    return this.textureKeyframes.includes(candidate);
  }
  refreshNearbyTextureKeyframe(
    colorAt,
    pose,
    view,
    motion = {},
    timestamp = 0,
  ) {
    if (
      !colorAt?.snapshot ||
      !this.isColorFrameReliable(motion) ||
      !this.keyframes.length
    )
      return false;
    const current = textureKeyframePoseForRetention({
      camera: new Float32Array([
        pose.position.x,
        pose.position.y,
        pose.position.z,
      ]),
      viewTransformMatrix: view.transform.matrix,
      timestamp,
    });
    const nearby = this.keyframes
      .map((frame, index) => {
        // Bound every refresh against the immutable depth pose. Comparing
        // against the last refreshed image allowed many 4 cm steps to chain
        // into a texture captured far from its occlusion/depth observation.
        const retained = keyframePoseForRetention(frame);
        const spatial = Math.hypot(
          current.position[0] - retained.position[0],
          current.position[1] - retained.position[1],
          current.position[2] - retained.position[2],
        );
        const directionDot = Math.max(
          -1,
          Math.min(
            1,
            current.direction[0] * retained.direction[0] +
              current.direction[1] * retained.direction[1] +
              current.direction[2] * retained.direction[2],
          ),
        );
        return { frame, index, spatial, angular: Math.acos(directionDot) };
      })
      // Reusing a texture from a meaningfully different camera pose would
      // itself create ghosting. Only a near-stationary revisit may refresh it.
      .filter(({ spatial, angular }) => spatial <= 0.04 && angular <= 0.07)
      .sort(
        (left, right) =>
          left.spatial / 0.04 + left.angular / 0.07 -
          (right.spatial / 0.04 + right.angular / 0.07),
      );
    const candidateQuality = textureQualityScore({
      colorSharpness: colorAt.sharpness,
      colorFocus: colorAt.focus,
      colorClippedRatio: colorAt.clippedRatio,
      textureLinearSpeed: motion.textureLinearSpeed ?? motion.linearSpeed,
      textureAngularSpeed: motion.textureAngularSpeed ?? motion.angularSpeed,
    });
    const target = nearby.find(({ frame }) => {
      if (!frame.colorImage?.length) return true;
      const previousQuality = textureQualityScore(frame);
      return candidateQuality > previousQuality * 1.12;
    });
    if (!target) return false;
    const snapshot = colorAt.snapshot();
    if (!snapshot?.data?.length) return false;
    Object.assign(target.frame, {
      colorImage: snapshot.data,
      colorWidth: snapshot.width,
      colorHeight: snapshot.height,
      colorChannels: snapshot.channels || 4,
      // The replacement image belongs to this exact XR view. Keep its camera
      // matrices separate from the original depth pose so texture projection
      // stays aligned without moving the geometry that was already accepted.
      viewProjectionMatrix: new Float32Array(view.projectionMatrix),
      viewTransformMatrix: new Float32Array(view.transform.matrix),
      colorSharpness:
        Number(colorAt.sharpness ?? snapshot.sharpness) || 0,
      colorFocus: Number(colorAt.focus ?? snapshot.focus) || 0,
      colorClippedRatio:
        Number(colorAt.clippedRatio ?? snapshot.clippedRatio) || 0,
      textureLinearSpeed: Number(motion.textureLinearSpeed ?? motion.linearSpeed) || 0,
      textureAngularSpeed: Number(motion.textureAngularSpeed ?? motion.angularSpeed) || 0,
      textureRefreshedAt: Number(timestamp) || 0,
    });
    this.stats.textureRefreshes++;
    this.compactTextureKeyframes();
    return !!target.frame.colorImage?.length;
  }
  refreshNearbyDepthKeyframe(
    points,
    view,
    columns,
    rows,
    timestamp,
    pose,
    depth = null,
    motion = {},
  ) {
    if (!points?.length || !this.keyframes.length) return false;
    const current = keyframePoseForRetention({
      camera: new Float32Array([pose.position.x, pose.position.y, pose.position.z]),
      transformMatrix: view.transform.matrix,
      timestamp,
    });
    const nearby = this.keyframes
      .map((frame, index) => {
        const retained = keyframePoseForRetention(frame);
        const spatial = Math.hypot(
          current.position[0] - retained.position[0],
          current.position[1] - retained.position[1],
          current.position[2] - retained.position[2],
        );
        const directionDot = Math.max(
          -1,
          Math.min(
            1,
            current.direction[0] * retained.direction[0] +
              current.direction[1] * retained.direction[1] +
              current.direction[2] * retained.direction[2],
          ),
        );
        return { frame, index, spatial, angular: Math.acos(directionDot) };
      })
      .filter(({ spatial, angular }) => spatial <= 0.04 && angular <= 0.07)
      .sort(
        (left, right) =>
          left.spatial / 0.04 + left.angular / 0.07 -
          (right.spatial / 0.04 + right.angular / 0.07),
      );
    if (!nearby.length) return false;
    const candidate = createRgbdKeyframe(points, {
      columns,
      rows,
      projectionMatrix: view.projectionMatrix,
      transformMatrix: view.transform.matrix,
      viewProjectionMatrix: view.projectionMatrix,
      viewTransformMatrix: view.transform.matrix,
      geometryMode: "view-aligned-v1",
      nativeDepthWidth: depth?.width || 0,
      nativeDepthHeight: depth?.height || 0,
      nativeDepthUvTransform: depth?.normDepthBufferFromNormView?.matrix,
      depthType: this.stats.depthType,
      camera: pose.position,
      timestamp,
      keepColor: false,
      linearSpeed: motion.linearSpeed,
      angularSpeed: motion.angularSpeed,
    });
    if (!candidate) return false;
    const filtered = filterDepth(candidate, { depthType: this.stats.depthType });
    const measuredCount = filtered.measuredMask.reduce(
      (count, value) => count + value,
      0,
    );
    const candidateQuality = Math.max(
      0,
      measuredCount - filtered.weakSupportedCount * 0.35,
    );
    candidate.depthQuality = candidateQuality;
    candidate.measuredDepthCount = measuredCount;
    const target = nearby.find(({ frame }) => {
      const previousQuality = Number(frame.depthQuality) || frame.validCount || 0;
      const previousMeasured =
        Number(frame.measuredDepthCount) || frame.validCount || 0;
      return (
        candidateQuality >= Math.max(8, previousQuality * 1.08) ||
        measuredCount >= previousMeasured + 12
      );
    });
    if (!target) return false;
    // Keep a previous sharp image only with its original camera pose. The
    // replacement is close enough for geometry, but its color projection must
    // not silently move with the new depth matrix.
    if (target.frame.colorImage?.length) {
      candidate.colorImage = target.frame.colorImage;
      candidate.colorWidth = target.frame.colorWidth;
      candidate.colorHeight = target.frame.colorHeight;
      candidate.colorChannels = target.frame.colorChannels;
      candidate.colorSharpness = target.frame.colorSharpness;
      candidate.colorFocus = target.frame.colorFocus;
      candidate.colorClippedRatio = target.frame.colorClippedRatio;
      candidate.textureLinearSpeed = target.frame.textureLinearSpeed;
      candidate.textureAngularSpeed = target.frame.textureAngularSpeed;
      candidate.viewProjectionMatrix = target.frame.viewProjectionMatrix;
      candidate.viewTransformMatrix = target.frame.viewTransformMatrix;
    }
    if (this.capture.frames.includes(target.frame)) {
      if (!this.capture.replace(target.frame, candidate)) return false;
      this.keyframes = this.capture.frames;
    } else this.keyframes[target.index] = candidate;
    this.stats.depthRefreshes++;
    // Remove the old observation from the live splat preview as well as from
    // final fusion. This rebuild is bounded by the same retained keyframes.
    this.rebuildPreviewCloud();
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
    const colorFrameReliable = this.isColorFrameReliable(motion, colorAt);
    // Per-depth RGB is cheap and remains useful to the fusion fallback even
    // when motion makes a full camera image unsuitable for the texture atlas.
    // Only the high-resolution image is withheld in that case.
    const colorSnapshot = colorFrameReliable && !this.textureKeyframes?.length
      ? colorAt?.snapshot?.() || null
      : null;
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
      depthType: this.stats.depthType,
      camera: pose.position,
      timestamp,
      colorImage: colorSnapshot,
      keepColor: !!colorAt,
      colorSharpness:
        Number(colorAt?.sharpness ?? colorSnapshot?.sharpness) || 0,
      colorClippedRatio:
        Number(colorAt?.clippedRatio ?? colorSnapshot?.clippedRatio) || 0,
      linearSpeed: motion.linearSpeed,
      angularSpeed: motion.angularSpeed,
    });
    if (!keyframe) return;
    const filtered = filterDepth(keyframe, { depthType: this.stats.depthType });
    keyframe.measuredDepthCount = filtered.measuredMask.reduce(
      (count, value) => count + value,
      0,
    );
    keyframe.depthQuality = Math.max(
      0,
      keyframe.measuredDepthCount - filtered.weakSupportedCount * 0.35,
    );
    keyframe.colorFocus =
      Number(colorAt?.focus ?? colorSnapshot?.focus) || 0;
    keyframe.textureLinearSpeed = colorSnapshot
      ? Number(motion.textureLinearSpeed ?? motion.linearSpeed) || 0
      : 0;
    keyframe.textureAngularSpeed = colorSnapshot
      ? Number(motion.textureAngularSpeed ?? motion.angularSpeed) || 0
      : 0;
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
  // Keep the atlas below the portable-export and mobile-GPU limits while
  // retaining one strong image from every section of the scan path. Fifteen
  // camera tiles plus the fallback tile fit a compact 4x4 atlas; this avoids
  // both a costly fifth row and a later global quality filter that could erase
  // the only texture view of a measured wall or ceiling.
  compactTextureKeyframes(
    maximum = MAX_TEXTURE_KEYFRAMES,
    retained = MAX_TEXTURE_KEYFRAMES,
  ) {
    const frames = [...this.keyframes, ...(this.textureKeyframes || [])];
    const textured = frames
      .map((frame, index) => (frame.colorImage?.length ? index : -1))
      .filter((index) => index >= 0);
    const largestImage = Math.max(1, ...textured.map((index) => frames[index].colorImage.byteLength));
    const budgetCount = Math.max(1, Math.floor(24 * 1024 * 1024 / largestImage));
    maximum = Math.min(maximum, budgetCount);
    if (textured.length > maximum) {
      const targetCount = Math.max(
        1,
        Math.min(maximum, retained, textured.length),
      );
      const keep = new Set(
        selectTextureKeyframesForRetention(frames, targetCount),
      );
      textured.forEach((index) => {
        if (!keep.has(index)) frames[index].colorImage = null;
      });
    }
    this.textureKeyframes = (this.textureKeyframes || []).filter((frame) => frame.colorImage?.length);
    this.stats.textureKeyframes = frames.reduce(
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
    this.cloud.add(points, frameId, frame.camera,
      point => capturePointObserved(frame, [point.x, point.y, point.z]));
  }
  rebuildPreviewCloud() {
    this.cloud = new VoxelCloud();
    this.keyframes.forEach((frame, index) => this.addSavedPreview(frame, frame.captureId ?? index));
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
    this.updateAdaptiveStats();
    return {
      points: this.cloud.values(true),
      keyframes: this.keyframes,
      textureKeyframes: this.textureKeyframes || [],
      maxTextureSize: this.renderer?.capabilities?.maxTextureSize || 4096,
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
