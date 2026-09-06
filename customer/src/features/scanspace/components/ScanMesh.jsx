import { useEffect, useMemo } from "react";
import * as THREE from "three";

export default function ScanMesh({ mesh, low = false }) {
  const resources = useMemo(() => {
    const value = new THREE.BufferGeometry();
    value.setAttribute(
      "position",
      new THREE.BufferAttribute(mesh.positions, 3),
    );
    value.setAttribute(
      "color",
      new THREE.BufferAttribute(mesh.colors, 3, true),
    );
    if (mesh.uvs)
      value.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    if (mesh.normals)
      value.setAttribute(
        "normal",
        new THREE.BufferAttribute(mesh.normals, 3),
      );
    value.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    if (!mesh.normals) value.computeVertexNormals();
    value.computeBoundingSphere();
    let texture = null;
    if (mesh.texture?.data) {
      texture = new THREE.DataTexture(
        mesh.texture.data,
        mesh.texture.width,
        mesh.texture.height,
        THREE.RGBAFormat,
      );
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
    }
    return { geometry: value, texture };
  }, [mesh]);
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
        <meshBasicMaterial
          vertexColors
          map={resources.texture}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      ) : (
        <meshStandardMaterial
          vertexColors
          side={THREE.DoubleSide}
          roughness={0.92}
          metalness={0}
          flatShading={low}
        />
      )}
    </mesh>
  );
}
