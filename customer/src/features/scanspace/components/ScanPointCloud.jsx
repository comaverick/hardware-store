import { useEffect, useMemo } from "react";
import * as THREE from "three";

function roundSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.72, "rgba(255,255,255,.96)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export default function ScanPointCloud({ cloud, low = false }) {
  const geometry = useMemo(() => {
    const value = new THREE.BufferGeometry();
    value.setAttribute(
      "position",
      new THREE.BufferAttribute(cloud.positions, 3),
    );
    value.setAttribute(
      "color",
      new THREE.BufferAttribute(cloud.colors, 3, true),
    );
    value.computeBoundingSphere();
    return value;
  }, [cloud]);
  const sprite = useMemo(roundSprite, []);
  useEffect(
    () => () => {
      geometry.dispose();
      sprite.dispose();
    },
    [geometry, sprite],
  );
  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={(cloud.pointSize || 0.055) * (low ? 1.15 : 1)}
        sizeAttenuation
        vertexColors
        alphaMap={sprite}
        alphaTest={0.08}
        transparent
        opacity={0.98}
        depthWrite
      />
    </points>
  );
}
