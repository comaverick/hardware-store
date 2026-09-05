import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

function MeasuredWall({ wall, texture }) {
  const [map, setMap] = useState(null);
  useEffect(() => {
    let active = true;
    let loaded;
    setMap(null);
    if (texture)
      new THREE.TextureLoader().load(texture, (value) => {
        loaded = value;
        if (!active) {
          value.dispose();
          return;
        }
        value.colorSpace = THREE.SRGBColorSpace;
        value.wrapS = value.wrapT = THREE.ClampToEdgeWrapping;
        setMap(value);
      });
    return () => {
      active = false;
      loaded?.dispose();
    };
  }, [texture]);

  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const length = Math.hypot(dx, dz);
  const angle = -Math.atan2(dz, dx);
  return (
    <group
      position={[
        (wall.start.x + wall.end.x) / 2,
        (wall.bottom || 0) + wall.height / 2,
        (wall.start.z + wall.end.z) / 2,
      ]}
      rotation={[0, angle, 0]}
    >
      <mesh receiveShadow>
        <planeGeometry args={[length, wall.height]} />
        <meshStandardMaterial
          map={map}
          color={map ? "#ffffff" : wall.material?.color || "#e6e1d8"}
          roughness={0.9}
          metalness={0}
          side={THREE.DoubleSide}
        />
        <Edges color="#52b999" transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

export default function PartialScanScene({ scan }) {
  const view = useMemo(() => {
    const xs = scan.walls.flatMap((wall) => [wall.start.x, wall.end.x]);
    const zs = scan.walls.flatMap((wall) => [wall.start.z, wall.end.z]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const height = Math.max(
      ...scan.walls.map((wall) => (wall.bottom || 0) + wall.height),
    );
    const center = {
      x: (minX + maxX) / 2,
      y: height / 2,
      z: (minZ + maxZ) / 2,
    };
    const extent = Math.max(2.2, maxX - minX, maxZ - minZ, height);
    return {
      center,
      extent,
      position: [
        center.x + extent * 1.15,
        center.y + extent * 0.65,
        center.z + extent * 1.15,
      ],
    };
  }, [scan]);

  return (
    <div className="ss-partial-scene">
      <Canvas
        camera={{ position: view.position, fov: 42, near: 0.04, far: 100 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={["#edf0ef"]} />
        <hemisphereLight args={["#fff8ec", "#a7b0ad", 2]} />
        <directionalLight position={[3, 7, 4]} intensity={2.2} />
        {scan.walls.map((wall) => (
          <MeasuredWall
            key={wall.id}
            wall={wall}
            texture={scan.textures?.[wall.id]}
          />
        ))}
        <gridHelper
          args={[view.extent * 3, 18, "#cbd5d0", "#dce3df"]}
          position={[view.center.x, -0.015, view.center.z]}
        />
        <OrbitControls
          makeDefault
          target={[view.center.x, view.center.y, view.center.z]}
          enableDamping
          minDistance={0.5}
          maxDistance={view.extent * 5}
        />
      </Canvas>
      <span className="ss-view-hint">Drag to orbit · Pinch to zoom</span>
      <span className="ss-partial-legend">
        <i /> Measured wall surface
      </span>
    </div>
  );
}
