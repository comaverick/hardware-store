import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { createScanMeshResources, shadeUnobservedBacks, observedSideProgramKey } from "../core/renderMesh";

export default function ScanMesh({ mesh, low = false, geometryOnly = false }) {
  const resources = useMemo(() => createScanMeshResources(mesh), [mesh]);
  const sided = mesh.observedSideOriented ? {
    onBeforeCompile: shadeUnobservedBacks, customProgramCacheKey: observedSideProgramKey,
  } : {};
  useEffect(
    () => () => {
      resources.geometry.dispose();
      resources.texture?.dispose();
    },
    [resources],
  );
  return (
    <mesh geometry={resources.geometry} frustumCulled={false}>
      {geometryOnly ? (
        <meshStandardMaterial {...sided} color="#b9c2c0" side={THREE.DoubleSide}
          roughness={1} metalness={0} flatShading={low} />
      ) : resources.texture ? (
        <meshBasicMaterial {...sided} vertexColors map={resources.texture}
          side={THREE.DoubleSide} toneMapped={false} />
      ) : mesh.portableColors ? (
        <meshBasicMaterial {...sided} vertexColors side={THREE.DoubleSide} toneMapped={false} />
      ) : (
        <meshStandardMaterial {...sided} vertexColors side={THREE.DoubleSide}
          roughness={0.92} metalness={0} flatShading={low} />
      )}
    </mesh>
  );
}
