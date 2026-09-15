import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { createScanMeshResources } from "../core/renderMesh";

export default function ScanMesh({ mesh, low = false }) {
  const resources = useMemo(() => createScanMeshResources(mesh), [mesh]);
  useEffect(
    () => () => {
      resources.geometry.dispose();
      resources.texture?.dispose();
    },
    [resources],
  );
  return (
    <mesh geometry={resources.geometry} frustumCulled={false}>
      {resources.texture ? (
        <meshBasicMaterial vertexColors map={resources.texture}
          side={THREE.DoubleSide} toneMapped={false} />
      ) : mesh.portableColors ? (
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} toneMapped={false} />
      ) : (
        <meshStandardMaterial vertexColors side={THREE.DoubleSide}
          roughness={0.92} metalness={0} flatShading={low} />
      )}
    </mesh>
  );
}
