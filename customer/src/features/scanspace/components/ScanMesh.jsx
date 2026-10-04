import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { createScanMeshResources, shadeUnobservedBacks, observedSideProgramKey } from "../core/renderMesh";
import { paintRoughness, sanitizeScanCustomization } from "../core/scanCustomization";
import { createScanFinishGeometry } from "../core/scanFinishRendering";
import { loadFloorFinishMaterial } from "../core/scanFloorMaterial";
import { getScanDesignSurfaces } from "../core/scanDesignSurfaces";
import {
  capturedWallLightReference, createWallLightingTexture, sidedWallPaintProgramKey,
  wallPaintProgramKey, wallPaintShader,
} from "../core/scanWallLighting";
import { createFloorLighting, floorFinishProgramKey, floorFinishShader,
  sidedFloorFinishProgramKey } from "../core/scanFloorLighting";

const preparedLightReference = [.5, .5, .5], neutralLightReference = [1, 1, 1];

function WallPaint({ finish, map, lightMap, reference = neutralLightReference, vertexColors = false,
  observedSide = false, attach, side = THREE.FrontSide }) {
  const shader = useMemo(() => wallPaintShader(reference, observedSide), [reference, observedSide]);
  return <meshStandardMaterial attach={attach} color={finish.color} map={map} lightMap={lightMap} vertexColors={vertexColors}
    roughness={paintRoughness(finish.finish)} metalness={0} side={side} toneMapped={false}
    onBeforeCompile={shader} customProgramCacheKey={observedSide ? sidedWallPaintProgramKey : wallPaintProgramKey} />;
}

function useFloorFinishMaterial(finishId, direction) {
  const [material, setMaterial] = useState(null);
  useEffect(() => {
    if (!finishId) return;
    let active = true, resources;
    loadFloorFinishMaterial({ finishId, direction }).then(value => {
      if (!active) { value?.dispose(); return; }
      resources = value;
      setMaterial(value);
    }).catch(() => { if (active) setMaterial(null); });
    return () => { active = false; resources?.dispose(); };
  }, [finishId, direction]);
  // Keep the photographed capture visible while a local material loads, or if
  // it fails. An earlier async selection must never replace the current one.
  return material && !material.disposed && material.finishId === finishId && material.direction === direction ? material : null;
}

function FloorFinish({ material, lighting, observedSide, attach, captured }) {
  const minimumRoughness = material?.minimumRoughness;
  const shader = useMemo(() => floorFinishShader(observedSide, minimumRoughness), [observedSide, minimumRoughness]);
  if (!material) return <CapturedMaterial attach={attach} {...captured} />;
  return <meshStandardMaterial attach={attach} color={material.color} map={material.map} lightMap={lighting?.texture}
    normalMap={material.normalMap} normalScale={material.normalScale} roughnessMap={material.roughnessMap}
    roughness={material.roughness} metalness={0} side={THREE.DoubleSide} toneMapped={false}
    onBeforeCompile={shader} customProgramCacheKey={observedSide ? sidedFloorFinishProgramKey : floorFinishProgramKey} />;
}

function CapturedMaterial({ mesh, resources, sided, low, attach }) {
  return resources.texture ? (
    <meshBasicMaterial {...sided} attach={attach} vertexColors map={resources.texture}
      side={THREE.DoubleSide} toneMapped={false} />
  ) : mesh.portableColors ? (
    <meshBasicMaterial {...sided} attach={attach} vertexColors side={THREE.DoubleSide} toneMapped={false} />
  ) : (
    <meshStandardMaterial {...sided} attach={attach} vertexColors side={THREE.DoubleSide}
      roughness={0.92} metalness={0} flatShading={low} />
  );
}

function CapturedSurface({ mesh, low, geometryOnly, applied, surfaces, design }) {
  const resources = useMemo(() => createScanMeshResources(mesh), [mesh]);
  const hasFinishes = !!(applied && surfaces?.labels.length);
  const hasWallFinish = !!applied?.walls;
  const wallReference = useMemo(() => hasWallFinish ? capturedWallLightReference(mesh, surfaces) : neutralLightReference,
    [hasWallFinish, mesh, surfaces]);
  const capturedWallProps = { finish: applied?.walls, map: resources.texture, reference: wallReference,
    vertexColors: true, observedSide: !!mesh.observedSideOriented, side: THREE.DoubleSide };
  const hasFloorFinish = !!applied?.floor;
  const floorLighting = useMemo(() => hasFloorFinish ? createFloorLighting(mesh, surfaces) : null,
    [hasFloorFinish, mesh, surfaces]);
  const finishGeometry = useMemo(() => hasFinishes || design
    ? createScanFinishGeometry(resources.geometry, mesh, surfaces || {
      labels: new Uint8Array(mesh.indices.length / 3), floorAxes: [[1, 0, 0], [0, 0, 1]],
    }, design?.removedSourceFaces, floorLighting) : null,
  [hasFinishes, mesh, resources.geometry, surfaces, design, floorLighting]);
  const fragments = design?.fragments;
  // Clipped details share the original atlas instead of allocating another
  // large captured-photo texture on the phone.
  const fragmentResources = useMemo(() => {
    if (!fragments?.indices?.length) return null;
    return createScanMeshResources(fragments);
  }, [fragments]);
  const fragmentFinishGeometry = useMemo(() => {
    if (!fragmentResources || !hasFinishes) return null;
    // Adjoining floor/ceiling faces keep their finish ownership after their
    // display edges move. Photographs still use the original atlas UV channel.
    const labels = Uint8Array.from(fragments.sourceFaces, face => surfaces.labels[face]);
    return createScanFinishGeometry(fragmentResources.geometry, fragments,
      { labels, floorAxes: surfaces.floorAxes }, null, floorLighting);
  }, [fragmentResources, fragments, hasFinishes, surfaces, floorLighting]);
  const finishId = applied?.floor?.finishId, direction = applied?.floor?.direction;
  const floorMaterial = useFloorFinishMaterial(finishId, direction);
  const sided = mesh.observedSideOriented ? {
    onBeforeCompile: shadeUnobservedBacks, customProgramCacheKey: observedSideProgramKey,
  } : {};
  const floorProps = { material: floorMaterial, lighting: floorLighting,
    observedSide: !!mesh.observedSideOriented, captured: { mesh, resources, sided, low } };
  useEffect(
    () => () => {
      resources.geometry.dispose();
      resources.texture?.dispose();
    },
    [resources],
  );
  useEffect(() => () => finishGeometry?.dispose(), [finishGeometry]);
  useEffect(() => () => fragmentResources?.geometry.dispose(), [fragmentResources]);
  useEffect(() => () => fragmentFinishGeometry?.dispose(), [fragmentFinishGeometry]);
  useEffect(() => () => floorLighting?.texture.dispose(), [floorLighting]);
  // Distinct keys remount materials when their attachment changes between a
  // single material and indexed groups; Fiber preserves an existing attachment.
  const primary = (
    <mesh geometry={geometryOnly ? resources.geometry : finishGeometry || resources.geometry} frustumCulled={false}>
      {geometryOnly ? (
        <meshStandardMaterial key="inspection" {...sided} color="#b9c2c0" side={THREE.DoubleSide}
          roughness={1} metalness={0} flatShading={low} />
      ) : hasFinishes ? (
        <>
          <CapturedMaterial key="captured-group" attach="material-0" {...{ mesh, resources, sided, low }} />
          {[[1, "walls"], [2, "floor"], [3, "ceiling"]].map(([index, kind]) =>
            applied[kind] ? kind === "walls" ? <WallPaint key={kind} attach={`material-${index}`} {...capturedWallProps} />
              : kind === "floor" ? <FloorFinish key={kind} attach={`material-${index}`} {...floorProps} /> : (
              <meshStandardMaterial key={kind} {...sided} attach={`material-${index}`}
                color={applied[kind].color} roughness={paintRoughness(applied[kind].finish)}
                metalness={0} side={THREE.DoubleSide} />
            ) : <CapturedMaterial key={kind} attach={`material-${index}`} {...{ mesh, resources, sided, low }} />)}
        </>
      ) : (
        <CapturedMaterial key="captured-single" {...{ mesh, resources, sided, low }} />
      )}
    </mesh>
  );
  return fragmentResources ? <group>
    {primary}
    <mesh geometry={fragmentFinishGeometry || fragmentResources.geometry} frustumCulled={false} name="captured-boundary-details">
      {hasFinishes ? <>
        <CapturedMaterial key="details" attach="material-0" {...{ mesh, resources, sided, low }} />
        {[[1, "walls"], [2, "floor"], [3, "ceiling"]].map(([index, kind]) => applied[kind]
          ? kind === "walls" ? <WallPaint key={kind} attach={`material-${index}`} {...capturedWallProps} />
          : kind === "floor" ? <FloorFinish key={kind} attach={`material-${index}`} {...floorProps} />
          : <meshStandardMaterial key={kind} {...sided} attach={`material-${index}`}
            color={applied[kind].color} roughness={paintRoughness(applied[kind].finish)}
            metalness={0} side={THREE.DoubleSide} />
          : <CapturedMaterial key={kind} attach={`material-${index}`} {...{ mesh, resources, sided, low }} />)}
      </> : <CapturedMaterial key="details-single" {...{ mesh, resources, sided, low }} />}
    </mesh>
  </group> : primary;
}

function DesignWall({ wall, finish }) {
  const resources = useMemo(() => createScanMeshResources(wall), [wall]);
  const lightingTexture = useMemo(() => createWallLightingTexture(wall), [wall]);
  const detailTexture = useMemo(() => {
    if (!wall.texture || !wall.detailMask?.some(Boolean)) return null;
    const pixels = wall.texture.data.slice();
    for (let i = 0; i < wall.detailMask.length; i++) pixels[i * 4 + 3] = wall.detailMask[i];
    const texture = new THREE.DataTexture(pixels, wall.texture.width, wall.texture.height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
    return texture;
  }, [wall]);
  useEffect(() => () => { resources.geometry.dispose(); resources.texture?.dispose(); detailTexture?.dispose(); },
    [resources, detailTexture]);
  useEffect(() => () => lightingTexture?.dispose(), [lightingTexture]);
  return <group name={wall.id}>
    <mesh geometry={resources.geometry} frustumCulled={false} name="prepared-wall">
      {finish ? <WallPaint key="paint" finish={finish} lightMap={lightingTexture}
        reference={lightingTexture ? preparedLightReference : neutralLightReference} />
        : <meshBasicMaterial key="photo" map={resources.texture} side={THREE.FrontSide} toneMapped={false} />}
    </mesh>
    <mesh geometry={resources.geometry} frustumCulled={false} name="prepared-wall-back">
      <meshBasicMaterial color="#505d57" side={THREE.BackSide} toneMapped={false} />
    </mesh>
    {finish && detailTexture && <mesh geometry={resources.geometry} frustumCulled={false}
      renderOrder={2} name="wall-photo-details">
      <meshBasicMaterial map={detailTexture} alphaTest={.5} side={THREE.FrontSide} toneMapped={false}
        polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
    </mesh>}
  </group>;
}

export default function ScanMesh({ mesh, low = false, geometryOnly = false, customization, surfaces }) {
  const design = useMemo(() => getScanDesignSurfaces(mesh), [mesh]);
  const applied = sanitizeScanCustomization(customization);
  const captured = <CapturedSurface {...{ mesh, low, geometryOnly, applied, surfaces }}
    design={geometryOnly ? null : design} />;
  return design && !geometryOnly ? <group name="prepared-room">
    {captured}
    {design.walls.map(wall => <DesignWall key={wall.id} wall={wall} finish={applied?.walls} />)}
  </group> : captured;
}
