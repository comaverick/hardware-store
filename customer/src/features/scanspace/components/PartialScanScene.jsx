import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import ScanPointCloud from "./ScanPointCloud";
import ScanMesh from "./ScanMesh";

const MOVEMENT_PADDING = 0.7;

function ScanControls({ cloud, input, view, reset }) {
  const { camera, gl } = useThree();
  const angle = useRef({ yaw: 0, pitch: 0 });
  useEffect(() => {
    camera.position.set(...view.position);
    angle.current = { yaw: view.yaw, pitch: 0 };
    camera.rotation.order = "YXZ";
    camera.rotation.set(0, angle.current.yaw, 0);
  }, [camera, reset, view]);
  useEffect(() => {
    const element = gl.domElement;
    let pointer = null;
    const down = (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      element.setPointerCapture?.(event.pointerId);
    };
    const move = (event) => {
      if (!pointer) return;
      angle.current.yaw -= (event.clientX - pointer.x) * 0.004;
      angle.current.pitch = Math.max(
        -1.35,
        Math.min(
          1.35,
          angle.current.pitch - (event.clientY - pointer.y) * 0.004,
        ),
      );
      pointer = { x: event.clientX, y: event.clientY };
    };
    const up = () => {
      pointer = null;
    };
    const key = (event) => {
      if (!["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"].includes(event.code)) return;
      if (event.type === "keydown" &&
        (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.isContentEditable)) return;
      input.current.keys[event.code] = event.type === "keydown";
    };
    const blur = () => {
      input.current.keys = {};
      input.current.x = input.current.y = 0;
      input.current.up = input.current.down = false;
      pointer = null;
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
      blur();
    };
  }, [gl, input, reset]);
  useFrame((_, delta) => {
    camera.rotation.order = "YXZ";
    camera.rotation.set(angle.current.pitch, angle.current.yaw, 0);
    const controls = input.current;
    const keys = controls.keys;
    const forward =
      -controls.y + (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const right = controls.x + (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const vertical =
      (controls.up || keys.KeyQ ? 1 : 0) - (controls.down || keys.KeyE ? 1 : 0);
    const speed =
      (Math.min(delta, 0.05) * 1.35) /
      Math.max(1, Math.hypot(forward, right, vertical));
    const dx =
      (Math.cos(angle.current.yaw) * right -
        Math.sin(angle.current.yaw) * forward) *
      speed;
    const dz =
      (-Math.sin(angle.current.yaw) * right -
        Math.cos(angle.current.yaw) * forward) *
      speed;
    camera.position.x = THREE.MathUtils.clamp(
      camera.position.x + dx,
      cloud.bounds.min.x - MOVEMENT_PADDING,
      cloud.bounds.max.x + MOVEMENT_PADDING,
    );
    camera.position.y = THREE.MathUtils.clamp(
      camera.position.y + vertical * speed,
      cloud.bounds.min.y - MOVEMENT_PADDING,
      cloud.bounds.max.y + MOVEMENT_PADDING,
    );
    camera.position.z = THREE.MathUtils.clamp(
      camera.position.z + dz,
      cloud.bounds.min.z - MOVEMENT_PADDING,
      cloud.bounds.max.z + MOVEMENT_PADDING,
    );
  });
  return null;
}

export default function PartialScanScene({ scan, compact = false, customization = scan.customization, surfaces }) {
  const [low, setLow] = useState(compact);
  const [reset, setReset] = useState(0);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const input = useRef({ x: 0, y: 0, up: false, down: false, keys: {} });
  const mesh = scan.mesh;
  const cloud = scan.cloud;
  const visual = mesh || cloud;
  const view = useMemo(() => {
    if (!visual)
      return {
        position: [0, 1.6, 0],
        yaw: 0,
      };
    const center = {
      x: (visual.bounds.min.x + visual.bounds.max.x) / 2,
      y: (visual.bounds.min.y + visual.bounds.max.y) / 2,
      z: (visual.bounds.min.z + visual.bounds.max.z) / 2,
    };
    const start = visual.observer || center;
    return {
      position: [
        start.x,
        THREE.MathUtils.clamp(start.y ?? 1.6,
          visual.bounds.min.y - MOVEMENT_PADDING,
          visual.bounds.max.y + MOVEMENT_PADDING),
        start.z,
      ],
      yaw: Math.atan2(-(center.x - start.x), -(center.z - start.z)),
    };
  }, [visual]);
  const joystick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const magnitude = Math.max(1, Math.hypot(x, y) / 32);
    const position = { x: x / magnitude, y: y / magnitude };
    input.current.x = position.x / 32;
    input.current.y = position.y / 32;
    setKnob(position);
  };
  const clearJoystick = () => {
    input.current.x = input.current.y = 0;
    setKnob({ x: 0, y: 0 });
  };
  if (!visual)
    return <div className="ss-notice">Captured depth is unavailable.</div>;
  return (
    <div className="ss-partial-scene">
      <Canvas
        frameloop="always"
        camera={{ position: view.position, fov: 48, near: 0.025, far: 100 }}
        dpr={low ? 1 : [1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.08;
        }}
      >
        <color attach="background" args={["#18211e"]} />
        <hemisphereLight args={["#fff8ed", "#66756f", 2.1]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 7, 4]} intensity={1.6} />
        {mesh ? (
          <ScanMesh mesh={mesh} low={low}
            customization={customization} surfaces={surfaces} />
        ) : (
          <ScanPointCloud cloud={cloud} low={low} />
        )}
        <ScanControls
          cloud={visual}
          input={input}
          view={view}
          reset={reset}
        />
      </Canvas>
      <div className="ss-partial-viewbar">
        <button type="button" aria-label="Reset camera" onClick={() => {
          clearJoystick();
          setReset((v) => v + 1);
        }}>
          Reset
        </button>
      </div>
      <div
        className="ss-joystick"
        role="group"
        aria-label="Movement joystick"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          joystick(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons) joystick(event);
        }}
        onPointerUp={clearJoystick}
        onPointerCancel={clearJoystick}
        onLostPointerCapture={clearJoystick}
      >
        <span style={{ transform: `translate(${knob.x}px,${knob.y}px)` }} />
        <small>Move</small>
      </div>
      <div className="ss-vertical-movement" role="group" aria-label="Camera height">
        {[["up", "Q", "↑", "Up"], ["down", "E", "↓", "Down"]].map(([direction, shortcut, arrow, label]) => (
          <button key={direction} type="button" aria-label={`Move ${direction}`}
            aria-keyshortcuts={shortcut} title={`Hold to move ${direction} (${shortcut})`}
            onPointerDown={(event) => {
              if (event.button > 0) return;
              event.currentTarget.setPointerCapture?.(event.pointerId);
              input.current[direction] = true;
            }}
            onPointerUp={() => { input.current[direction] = false; }}
            onPointerCancel={() => { input.current[direction] = false; }}
            onLostPointerCapture={() => { input.current[direction] = false; }}
            onKeyDown={(event) => {
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              input.current[direction] = true;
            }}
            onKeyUp={(event) => {
              if (event.key !== " " && event.key !== "Enter") return;
              event.preventDefault();
              input.current[direction] = false;
            }}
            onBlur={() => { input.current[direction] = false; }}>
            <span aria-hidden="true">{arrow}</span> {label}
          </button>
        ))}
      </div>
      <span className="ss-view-hint">
        Drag to look · Joystick / WASD · Q up / E down
      </span>
      <span className="ss-partial-legend" role="status">
        <i />{" "}
        {mesh ? mesh.designSurfaces?.ceilings?.length ? "Prepared surfaces + estimates"
            : mesh.designSurfaces?.walls?.length ? "Prepared walls + estimates"
            : mesh.surfaceRepair?.estimatedHoleCount > 0 ? "Measured + estimated repairs" : "Captured measured surface"
          : "Captured depth points"}
      </span>
      {!compact && <button
        className="ss-quality"
        aria-pressed={low}
        onClick={() => setLow((value) => !value)}
      >
        {low ? "Display: saver" : "Display: high"}
      </button>}
    </div>
  );
}
