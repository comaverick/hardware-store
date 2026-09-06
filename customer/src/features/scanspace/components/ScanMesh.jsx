import { useEffect, useMemo } from "react";
import * as THREE from "three";

export default function ScanMesh({ mesh, low = false }) {
  const geometry = useMemo(() => {
    const value = new THREE.BufferGeometry();
    value.setAttribute(
      "position",
      new THREE.BufferAttribute(mesh.positions, 3),
    );
    value.setAttribute(
      "color",
      new THREE.BufferAttribute(mesh.colors, 3, true),
    );
    value.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    value.computeVertexNormals();
    value.computeBoundingSphere();
    return value;
  }, [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <meshStandardMaterial
        vertexColors
        side={THREE.DoubleSide}
        roughness={0.92}
        metalness={0}
        flatShading={low}
      />
    </mesh>
  );
}
