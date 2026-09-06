import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  useGLTF,
  Html,
} from "@react-three/drei";
import * as THREE from "three";
import ScanPointCloud from "./ScanPointCloud";
import ScanMesh from "./ScanMesh";
import {
  distance,
  roomCenter,
  walkable,
  placementValid,
  signedArea,
} from "../core/domain";

function makePattern(m) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = m.color;
  ctx.fillRect(0, 0, 256, 256);
  if (m.kind === "wood") {
    for (let i = 0; i < 90; i++) {
      const y = (i * 47) % 256;
      ctx.strokeStyle = `rgba(71,43,24,${0.025 + (i % 4) * 0.018})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(80, y - 6, 160, y + 6, 256, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(52,37,24,.23)";
    ctx.fillRect(0, 0, 256, 2);
    ctx.fillRect(0, 0, 1, 256);
  }
  if (m.kind === "tile") {
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, 256, 256);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function SurfaceMaterial({ material: m, captured, inferred = false, onError }) {
  const [external, setExternal] = useState(null);
  const pattern = useMemo(() => makePattern(m), [m]);
  useEffect(() => () => pattern.dispose(), [pattern]);
  useEffect(() => {
    let active = true,
      loaded;
    setExternal(null);
    const url = captured || m.textureUrl;
    if (url) {
      new THREE.TextureLoader().load(
        url,
        (t) => {
          loaded = t;
          if (!active) {
            t.dispose();
            return;
          }
          t.colorSpace = THREE.SRGBColorSpace;
          t.wrapS = t.wrapT = captured
            ? THREE.ClampToEdgeWrapping
            : THREE.RepeatWrapping;
          t.anisotropy = 4;
          setExternal(t);
        },
        undefined,
        () =>
          onError?.(
            "A surface texture could not load. Its color is still available.",
          ),
      );
    }
    return () => {
      active = false;
      loaded?.dispose();
    };
  }, [captured, m.textureUrl, onError]);
  const texture = external || pattern;
  useEffect(() => {
    texture.center.set(0.5, 0.5);
    texture.rotation = captured ? 0 : (m.rotation * Math.PI) / 180;
    texture.repeat.set(
      captured ? 1 : 1 / m.tileSize,
      captured ? 1 : 1 / m.tileSize,
    );
  }, [texture, m.rotation, m.tileSize, captured]);
  return (
    <meshStandardMaterial
      map={texture}
      roughness={m.kind === "tile" ? 0.65 : 0.9}
      metalness={0}
      transparent={inferred}
      opacity={inferred ? 0.72 : 1}
      depthWrite={!inferred}
      side={inferred ? THREE.DoubleSide : THREE.FrontSide}
    />
  );
}
function wallShape(w, flip = false, captured = false) {
  const length = distance(w.start, w.end),
    shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(length, 0);
  shape.lineTo(length, w.height);
  shape.lineTo(0, w.height);
  shape.closePath();
  w.openings.forEach((o) => {
    const h = new THREE.Path();
    h.moveTo(o.offset, o.bottom);
    h.lineTo(o.offset, o.bottom + o.height);
    h.lineTo(o.offset + o.width, o.bottom + o.height);
    h.lineTo(o.offset + o.width, o.bottom);
    h.closePath();
    shape.holes.push(h);
  });
  const geo = new THREE.ShapeGeometry(shape);
  if (captured) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, uv.getX(i) / length, uv.getY(i) / w.height);
  }
  if (flip) {
    const index = geo.index;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      index.setX(i, index.getX(i + 2));
      index.setX(i + 2, a);
    }
    geo.computeVertexNormals();
  }
  return geo;
}
function Wall({ wall, selected, onSelect, flip, texture, onError }) {
  const geo = useMemo(
    () => wallShape(wall, flip, !!texture),
    [wall, flip, texture],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  const angle = -Math.atan2(
    wall.end.z - wall.start.z,
    wall.end.x - wall.start.x,
  );
  return (
    <group position={[wall.start.x, 0, wall.start.z]} rotation={[0, angle, 0]}>
      <mesh
        geometry={geo}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelect(wall.id);
        }}
      >
        <SurfaceMaterial
          material={wall.material}
          captured={texture}
          inferred={wall.inferred}
          onError={onError}
        />
      </mesh>
      {selected && (
        <lineSegments>
          <edgesGeometry args={[geo]} />
          <lineBasicMaterial color="#dc652f" />
        </lineSegments>
      )}
      {wall.openings.map((o) => (
        <group
          key={o.id}
          position={[o.offset + o.width / 2, o.bottom + o.height / 2, 0]}
        >
          {o.type === "window" && (
            <mesh>
              <planeGeometry args={[o.width, o.height]} />
              <meshStandardMaterial
                color="#d6e8e5"
                transparent
                opacity={0.25}
                side={THREE.DoubleSide}
                roughness={0.15}
              />
            </mesh>
          )}
          {[
            [0, -o.height / 2, o.width + 0.07, 0.045],
            [0, o.height / 2, o.width + 0.07, 0.045],
            [-o.width / 2, 0, 0.045, o.height],
            [o.width / 2, 0, 0.045, o.height],
          ].map(([x, y, w, h], i) => (
            <mesh key={i} position={[x, y, 0]} castShadow>
              <boxGeometry args={[w, h, 0.1]} />
              <meshStandardMaterial color="#f7f3ed" roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
class AssetBoundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
const modelUsers = new Map();
function Model({ item }) {
  const { scene } = useGLTF(item.modelUrl);
  const model = useMemo(() => scene.clone(true), [scene]);
  const bounds = useMemo(() => new THREE.Box3().setFromObject(model), [model]),
    size = bounds.getSize(new THREE.Vector3()),
    center = bounds.getCenter(new THREE.Vector3());
  const scale = [
    item.dimensions.width / Math.max(size.x, 0.001),
    item.dimensions.height / Math.max(size.y, 0.001),
    item.dimensions.depth / Math.max(size.z, 0.001),
  ];
  useEffect(() => {
    const entry = modelUsers.get(item.modelUrl) || { count: 0, timer: null };
    clearTimeout(entry.timer);
    entry.count++;
    modelUsers.set(item.modelUrl, entry);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return () => {
      entry.count--;
      entry.timer = setTimeout(() => {
        if (entry.count) return;
        scene.traverse((o) => {
          o.geometry?.dispose();
          const materials = Array.isArray(o.material)
            ? o.material
            : [o.material];
          materials.filter(Boolean).forEach((m) => {
            Object.values(m).forEach((v) => {
              if (v?.isTexture) v.dispose();
            });
            m.dispose();
          });
        });
        useGLTF.clear(item.modelUrl);
        modelUsers.delete(item.modelUrl);
      }, 500);
    };
  }, [model, scene, item.modelUrl]);
  return (
    <group scale={scale}>
      <primitive
        object={model}
        position={[-center.x, -bounds.min.y, -center.z]}
      />
    </group>
  );
}
function Proxy({ item }) {
  return (
    <mesh position={[0, item.dimensions.height / 2, 0]} castShadow>
      <boxGeometry
        args={[
          item.dimensions.width,
          item.dimensions.height,
          item.dimensions.depth,
        ]}
      />
      <meshStandardMaterial color={item.color || "#ac9476"} roughness={0.85} />
    </mesh>
  );
}
function ObjectMesh({ item, selected, onSelect, onDragStart }) {
  return (
    <group
      position={[item.position.x, item.position.y, item.position.z]}
      rotation={[0, item.rotation, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item.id);
      }}
      onPointerDown={(e) => {
        if (onDragStart) {
          e.stopPropagation();
          onDragStart(item.id);
        }
      }}
    >
      <AssetBoundary
        key={item.modelUrl}
        fallback={
          <>
            <Proxy item={item} />
            <Html center position={[0, item.dimensions.height + 0.12, 0]}>
              <span className="ss-model-label">Model unavailable</span>
            </Html>
          </>
        }
      >
        {item.modelUrl ? (
          <Suspense fallback={<Proxy item={item} />}>
            <Model item={item} />
          </Suspense>
        ) : (
          <>
            <Proxy item={item} />
            <Html center position={[0, item.dimensions.height + 0.12, 0]}>
              <span className="ss-model-label">Size preview</span>
            </Html>
          </>
        )}
      </AssetBoundary>
      {selected && (
        <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry
            args={[item.dimensions.width + 0.12, item.dimensions.depth + 0.12]}
          />
          <meshBasicMaterial color="#e96b32" transparent opacity={0.35} />
        </mesh>
      )}
    </group>
  );
}
function CameraControls({ room, mode, input, reset, dragging }) {
  const { camera, gl } = useThree(),
    control = useRef(),
    angle = useRef({ yaw: 0, pitch: 0 }),
    center = useMemo(
      () => ({
        x:
          room.floorPolygon.reduce((s, p) => s + p.x, 0) /
          room.floorPolygon.length,
        z:
          room.floorPolygon.reduce((s, p) => s + p.z, 0) /
          room.floorPolygon.length,
      }),
      [room.floorPolygon],
    );
  const extent = useMemo(
    () =>
      Math.max(
        ...room.floorPolygon.map((p) =>
          Math.hypot(p.x - center.x, p.z - center.z),
        ),
      ) * 2,
    [room, center],
  );
  useEffect(() => {
    angle.current = { yaw: 0, pitch: 0 };
    camera.up.set(0, 1, 0);
    if (mode === "first") {
      const start = roomCenter(room);
      camera.position.set(
        start.x,
        Math.min(1.62, room.ceilingHeight - 0.15),
        start.z,
      );
      angle.current.pitch = -0.12;
      camera.rotation.set(-0.12, 0, 0);
    } else {
      camera.position.set(
        center.x + (mode === "top" ? 0 : extent),
        mode === "top" ? 20 : extent * 0.95,
        center.z + (mode === "top" ? 0.001 : extent),
      );
      camera.lookAt(center.x, 0, center.z);
      if (control.current) {
        control.current.target.set(center.x, 0.7, center.z);
        control.current.update();
      }
    } /* Reset only on explicit camera changes. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, mode, reset]);
  useEffect(() => {
    if (mode !== "first") return;
    const el = gl.domElement;
    let pointer = null,
      last;
    const down = (e) => {
      pointer = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (e.pointerId !== pointer) return;
      angle.current.yaw -= (e.clientX - last.x) * 0.004;
      angle.current.pitch = Math.max(
        -1.35,
        Math.min(1.35, angle.current.pitch - (e.clientY - last.y) * 0.004),
      );
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      pointer = null;
    };
    const key = (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      input.current.keys[e.code] = e.type === "keydown";
    };
    const blur = () => {
      input.current.keys = {};
      input.current.x = input.current.y = 0;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
      blur();
    };
  }, [mode, gl, input]);
  useFrame((_, delta) => {
    if (mode !== "first") return;
    camera.rotation.order = "YXZ";
    camera.rotation.set(angle.current.pitch, angle.current.yaw, 0);
    const i = input.current,
      k = i.keys,
      forward = -i.y + (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0),
      right = i.x + (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0),
      speed =
        (Math.min(delta, 0.05) * 1.5) / Math.max(1, Math.hypot(forward, right)),
      yaw = angle.current.yaw;
    const dx = (Math.cos(yaw) * right - Math.sin(yaw) * forward) * speed,
      dz = (-Math.sin(yaw) * right - Math.cos(yaw) * forward) * speed;
    if (walkable({ x: camera.position.x + dx, z: camera.position.z }, room))
      camera.position.x += dx;
    if (walkable({ x: camera.position.x, z: camera.position.z + dz }, room))
      camera.position.z += dz;
  });
  return mode === "first" ? null : (
    <OrbitControls
      ref={control}
      enabled={!dragging}
      makeDefault
      enableRotate={mode !== "top"}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={2}
      maxDistance={35}
      minZoom={15}
      maxZoom={180}
    />
  );
}
function Performance({ setLow }) {
  let slow = useRef(0);
  useFrame((_, delta) => {
    if (delta > 0.045) slow.current++;
    else slow.current = Math.max(0, slow.current - 1);
    if (slow.current > 80) {
      setLow(true);
      slow.current = -100000;
    }
  });
  return null;
}

export default function RoomScene({
  room,
  mode,
  selected,
  onSelect,
  onMove,
  textures = {},
  showCapture = false,
  scanCloud = null,
  scanMesh = null,
  showScan = false,
  onError,
  reset = 0,
  snap = true,
  snapWall = false,
}) {
  const input = useRef({ x: 0, y: 0, keys: {} }),
    [low, setLow] = useState((navigator.hardwareConcurrency || 4) < 5),
    [dragging, setDragging] = useState(null),
    [dragPosition, setDragPosition] = useState(null),
    [knob, setKnob] = useState({ x: 0, y: 0 });
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    room.floorPolygon.forEach((p, i) =>
      i ? s.lineTo(p.x, -p.z) : s.moveTo(p.x, -p.z),
    );
    s.closePath();
    return s;
  }, [room.floorPolygon]);
  const geometry = useMemo(() => new THREE.ShapeGeometry(shape), [shape]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const ceilingGeo = useMemo(() => {
    const s = geometry.clone();
    const idx = s.index;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      idx.setX(i, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
    s.computeVertexNormals();
    return s;
  }, [geometry]);
  useEffect(() => () => ceilingGeo.dispose(), [ceilingGeo]);
  const move = (e) => {
    if (!dragging) return;
    e.stopPropagation();
    let { x, z } = e.point;
    if (snap) {
      x = Math.round(x * 10) / 10;
      z = Math.round(z * 10) / 10;
    }
    const object = room.placedProducts.find((o) => o.id === dragging);
    if (!object) return;
    if (snapWall) {
      let best = null;
      for (const w of room.walls) {
        const dx = w.end.x - w.start.x,
          dz = w.end.z - w.start.z,
          len = Math.hypot(dx, dz),
          t = Math.max(
            0,
            Math.min(
              1,
              ((x - w.start.x) * dx + (z - w.start.z) * dz) / (len * len),
            ),
          ),
          px = w.start.x + t * dx,
          pz = w.start.z + t * dz,
          d = Math.hypot(x - px, z - pz);
        if (!best || d < best.d) {
          const sign = signedArea(room.floorPolygon) > 0 ? 1 : -1;
          const offset =
            Math.max(object.dimensions.width, object.dimensions.depth) / 2 +
            0.03;
          best = {
            d,
            x: px - (dz / len) * sign * offset,
            z: pz + (dx / len) * sign * offset,
          };
        }
      }
      if (best && best.d < 0.65) {
        x = best.x;
        z = best.z;
      }
    }
    const position = { ...object.position, x, z };
    if (placementValid({ ...object, position }, room.floorPolygon))
      setDragPosition(position);
  };
  useEffect(() => {
    const up = () => {
      if (dragging && dragPosition) onMove(dragging, dragPosition);
      setDragging(null);
      setDragPosition(null);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, dragPosition, onMove]);
  const joystick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect(),
      x = e.clientX - rect.left - rect.width / 2,
      y = e.clientY - rect.top - rect.height / 2,
      m = Math.max(1, Math.hypot(x, y) / 32),
      p = { x: x / m, y: y / m };
    input.current.x = p.x / 32;
    input.current.y = p.y / 32;
    setKnob(p);
  };
  const clearJoystick = () => {
    input.current.x = input.current.y = 0;
    setKnob({ x: 0, y: 0 });
  };
  return (
    <div className="ss-scene">
      <Canvas
        shadows={low ? false : THREE.PCFShadowMap}
        dpr={low ? 1 : [1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
        }}
        fallback={
          <div className="ss-notice">
            3D graphics are unavailable. Use another browser with WebGL enabled.
          </div>
        }
      >
        <color
          attach="background"
          args={[showScan ? "#18211e" : "#edf0ef"]}
        />
        {mode === "top" ? (
          <OrthographicCamera
            key="top"
            makeDefault
            position={[2, 20, 2]}
            zoom={60}
            near={0.1}
            far={100}
          />
        ) : (
          <PerspectiveCamera
            key={mode}
            makeDefault
            position={[8, 7, 8]}
            fov={mode === "first" ? 68 : 40}
            near={0.04}
            far={120}
          />
        )}
        <CameraControls
          room={room}
          mode={mode}
          input={input}
          reset={reset}
          dragging={dragging}
        />
        <Performance setLow={setLow} />
        <hemisphereLight args={["#fff7e9", "#a1adab", 2]} />
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[1, 7, -2]}
          intensity={2.5}
          castShadow={!low}
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
          shadow-bias={-0.0004}
        />
        {showScan && scanMesh ? (
          <ScanMesh mesh={scanMesh} low={low} />
        ) : (
          showScan &&
          scanCloud && <ScanPointCloud cloud={scanCloud} low={low} />
        )}
        <mesh
          geometry={geometry}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
          visible={!showScan}
          onClick={(e) => {
            e.stopPropagation();
            if (!dragging) onSelect("floor");
          }}
        >
          <SurfaceMaterial material={room.floorMaterial} onError={onError} />
        </mesh>
        {mode === "first" && !showScan && (
          <mesh
            geometry={ceilingGeo}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, room.ceilingHeight, 0]}
          >
            <SurfaceMaterial
              material={room.ceilingMaterial}
              onError={onError}
            />
          </mesh>
        )}
        {!showScan && room.walls.map((w) => (
          <Wall
            key={w.id}
            wall={w}
            selected={selected === w.id}
            onSelect={onSelect}
            flip={signedArea(room.floorPolygon) < 0}
            texture={showCapture ? textures[w.id] : null}
            onError={onError}
          />
        ))}
        {!showScan && room.placedProducts.map((o) => (
          <ObjectMesh
            key={o.id}
            item={
              dragging === o.id && dragPosition
                ? { ...o, position: dragPosition }
                : o
            }
            selected={selected === o.id}
            onSelect={onSelect}
            onDragStart={
              mode === "top"
                ? (id) => {
                    setDragging(id);
                    onSelect(id);
                  }
                : null
            }
          />
        ))}
        {dragging && !showScan && (
          <mesh
            position={[0, 0.025, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            onPointerMove={move}
          >
            <planeGeometry args={[200, 200]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
        {!showScan && mode === "top" &&
          room.walls.map((w) => (
            <Html
              key={w.id}
              position={[
                (w.start.x + w.end.x) / 2,
                0.05,
                (w.start.z + w.end.z) / 2,
              ]}
              center
            >
              <span className="ss-measure">
                {distance(w.start, w.end).toFixed(2)} m
              </span>
            </Html>
          ))}
        <mesh
          position={[0, -0.05, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
          visible={!showScan}
        >
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color="#e8edeb" roughness={1} />
        </mesh>
      </Canvas>
      {mode === "first" && (
        <div
          className="ss-joystick"
          role="group"
          aria-label="Movement joystick"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            joystick(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons) joystick(e);
          }}
          onPointerUp={clearJoystick}
          onPointerCancel={clearJoystick}
        >
          <span style={{ transform: `translate(${knob.x}px,${knob.y}px)` }} />
          <small>Move</small>
        </div>
      )}
      <span className="ss-view-hint">
        {mode === "first"
          ? "Drag to look · Joystick or WASD to walk"
          : mode === "top"
            ? "Drag objects to place · Pinch to zoom"
            : "Drag to orbit · Pinch to zoom"}
      </span>
      <button className="ss-quality" onClick={() => setLow(!low)}>
        {low ? "Battery saver" : "High quality"}
      </button>
    </div>
  );
}
