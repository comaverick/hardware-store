import { useEffect, useMemo } from "react";
import * as THREE from "three";

// Textured fusion duplicates vertices so each triangle can use the camera
// frame that saw it. That is necessary for color continuity, but it also
// means the normal mesh boundary is no longer available to the renderer.
// Recover that topology by grouping exact duplicate positions and apply a
// small tangential pass to open-boundary vertices. This softens depth-noise
// teeth without moving a vertex through the measured surface, closing an
// opening, or adding any geometry. The same display correction therefore
// applies to live and imported scans.
function stabilizeRenderableBoundary(mesh) {
  if (!mesh?.positions?.length || !mesh?.indices?.length)
    return mesh?.positions || null;
  const vertexCount = mesh.positions.length / 3;
  const vertexGroups = new Int32Array(vertexCount);
  const groups = [];
  const lookup = new Map();
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const offset = vertex * 3;
    const key = `${mesh.positions[offset]},${mesh.positions[offset + 1]},${mesh.positions[offset + 2]}`;
    let group = lookup.get(key);
    if (group === undefined) {
      group = groups.length;
      lookup.set(key, group);
      groups.push({
        x: mesh.positions[offset],
        y: mesh.positions[offset + 1],
        z: mesh.positions[offset + 2],
      });
    }
    vertexGroups[vertex] = group;
  }
  if (groups.length === vertexCount) return mesh.positions;

  const neighbors = Array.from({ length: groups.length }, () => new Set());
  const edgeUses = new Map();
  const verticalSamples = [];
  const horizontalSamples = [];
  const edgeKey = (left, right) =>
    left < right ? `${left},${right}` : `${right},${left}`;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const first = vertexGroups[mesh.indices[index]];
    const second = vertexGroups[mesh.indices[index + 1]];
    const third = vertexGroups[mesh.indices[index + 2]];
    const triangle = [first, second, third];
    triangle.forEach((left, corner) => {
      const right = triangle[(corner + 1) % 3];
      if (left === right) return;
      neighbors[left].add(right);
      neighbors[right].add(left);
      const key = edgeKey(left, right);
      edgeUses.set(key, (edgeUses.get(key) || 0) + 1);
    });
    const firstOffset = mesh.indices[index] * 3;
    const secondOffset = mesh.indices[index + 1] * 3;
    const thirdOffset = mesh.indices[index + 2] * 3;
    const ab = [
      mesh.positions[secondOffset] - mesh.positions[firstOffset],
      mesh.positions[secondOffset + 1] - mesh.positions[firstOffset + 1],
      mesh.positions[secondOffset + 2] - mesh.positions[firstOffset + 2],
    ];
    const ac = [
      mesh.positions[thirdOffset] - mesh.positions[firstOffset],
      mesh.positions[thirdOffset + 1] - mesh.positions[firstOffset + 1],
      mesh.positions[thirdOffset + 2] - mesh.positions[firstOffset + 2],
    ];
    const face = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const twiceArea = Math.hypot(...face);
    if (twiceArea < 0.00001) continue;
    const normal = face.map((value) => value / twiceArea);
    const area = twiceArea * 0.5;
    const center = {
      x: (mesh.positions[firstOffset] +
        mesh.positions[secondOffset] +
        mesh.positions[thirdOffset]) /
        3,
      y: (mesh.positions[firstOffset + 1] +
        mesh.positions[secondOffset + 1] +
        mesh.positions[thirdOffset + 1]) /
        3,
      z: (mesh.positions[firstOffset + 2] +
        mesh.positions[secondOffset + 2] +
        mesh.positions[thirdOffset + 2]) /
        3,
    };
    if (Math.abs(normal[1]) < 0.45 && Math.hypot(normal[0], normal[2]) >= 0.75) {
      let nx = normal[0];
      let nz = normal[2];
      if (nx < 0 || (Math.abs(nx) < 0.0001 && nz < 0)) {
        nx *= -1;
        nz *= -1;
      }
      verticalSamples.push({
        nx,
        nz,
        area,
        offset: nx * center.x + nz * center.z,
      });
    } else if (Math.abs(normal[1]) >= 0.88) {
      horizontalSamples.push({ y: center.y, area });
    }
  }
  const boundary = new Uint8Array(groups.length);
  edgeUses.forEach((uses, key) => {
    if (uses !== 1) return;
    key.split(",").forEach((group) => {
      boundary[Number(group)] = 1;
    });
  });

  const normals = Array.from({ length: groups.length }, () => [0, 0, 0]);
  if (mesh.normals?.length === mesh.positions.length) {
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const offset = vertex * 3;
      const normal = normals[vertexGroups[vertex]];
      normal[0] += mesh.normals[offset];
      normal[1] += mesh.normals[offset + 1];
      normal[2] += mesh.normals[offset + 2];
    }
  } else {
    for (let index = 0; index < mesh.indices.length; index += 3) {
      const first = mesh.indices[index] * 3;
      const second = mesh.indices[index + 1] * 3;
      const third = mesh.indices[index + 2] * 3;
      const ab = [
        mesh.positions[second] - mesh.positions[first],
        mesh.positions[second + 1] - mesh.positions[first + 1],
        mesh.positions[second + 2] - mesh.positions[first + 2],
      ];
      const ac = [
        mesh.positions[third] - mesh.positions[first],
        mesh.positions[third + 1] - mesh.positions[first + 1],
        mesh.positions[third + 2] - mesh.positions[first + 2],
      ];
      const face = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      [first, second, third].forEach((offset) => {
        const normal = normals[vertexGroups[offset / 3]];
        normal[0] += face[0];
        normal[1] += face[1];
        normal[2] += face[2];
      });
    }
  }
  normals.forEach((normal) => {
    const length = Math.hypot(...normal) || 1;
    normal[0] /= length;
    normal[1] /= length;
    normal[2] /= length;
  });

  const clusterPlanes = (samples, axis) => {
    if (!samples.length) return [];
    const totalArea = samples.reduce((sum, sample) => sum + sample.area, 0);
    if (axis === "y") {
      const clusters = [];
      samples.forEach((sample) => {
        const cluster = clusters[clusters.length - 1];
        if (!cluster || Math.abs(sample.y - cluster.y) > 0.055) {
          clusters.push({ y: sample.y, area: sample.area, weighted: sample.y * sample.area });
          return;
        }
        cluster.area += sample.area;
        cluster.weighted += sample.y * sample.area;
        cluster.y = cluster.weighted / cluster.area;
      });
      return clusters
        .filter((cluster) => cluster.area >= Math.max(0.055, totalArea * 0.05))
        .sort((left, right) => right.area - left.area)
        .slice(0, 3)
        .map((cluster) => ({ y: cluster.weighted / cluster.area }));
    }

    // Wall normals are unoriented: a front wall can be seen from either
    // side, so +Z and -Z belong to the same plane family. Cluster by the
    // absolute dot product instead of signed angle to avoid splitting one
    // wall into two weak clusters.
    const clusters = [];
    samples.forEach((sample) => {
      let cluster = clusters.find(
        (candidate) =>
          Math.abs(sample.nx * candidate.nx + sample.nz * candidate.nz) >= 0.9,
      );
      if (!cluster) {
        cluster = { nx: sample.nx, nz: sample.nz, area: 0, samples: [] };
        clusters.push(cluster);
      }
      const sign = sample.nx * cluster.nx + sample.nz * cluster.nz < 0 ? -1 : 1;
      cluster.area += sample.area;
      cluster.nx += sample.nx * sign * sample.area;
      cluster.nz += sample.nz * sign * sample.area;
      cluster.samples.push({
        ...sample,
        nx: sample.nx * sign,
        nz: sample.nz * sign,
        offset: sample.offset * sign,
      });
    });
    return clusters
      .filter((cluster) => cluster.area >= Math.max(0.055, totalArea * 0.05))
      .sort((left, right) => right.area - left.area)
      .slice(0, 3)
      .map((cluster) => {
        const length = Math.hypot(cluster.nx, cluster.nz) || 1;
        const nx = cluster.nx / length;
        const nz = cluster.nz / length;
        const aligned = cluster.samples.filter(
          (sample) => Math.abs(sample.nx * nx + sample.nz * nz) >= 0.9,
        );
        const offsets = aligned
          .map((sample) => ({ value: sample.offset, area: sample.area }))
          .sort((left, right) => left.value - right.value);
        let accumulated = 0;
        const halfArea = aligned.reduce((sum, sample) => sum + sample.area, 0) / 2;
        const offset =
          offsets.find((sample) => {
            accumulated += sample.area;
            return accumulated >= halfArea;
          })?.value ?? 0;
        return { nx, nz, offset };
      });
  };
  const planes = clusterPlanes(
    verticalSamples
      .slice()
      .sort((left, right) => Math.atan2(left.nz, left.nx) - Math.atan2(right.nz, right.nx)),
    "vertical",
  );
  const horizontalPlanes = clusterPlanes(
    horizontalSamples
      .slice()
      .sort((left, right) => left.y - right.y),
    "y",
  );
  const target = groups.map((group) => [group.x, group.y, group.z]);
  // Pull only vertices already close to a dominant measured plane. This
  // removes small pose/depth bows from walls and shelves while keeping
  // recessed objects and larger gaps in their captured positions.
  groups.forEach((group, groupIndex) => {
    const normal = normals[groupIndex];
    let best = null;
    planes.forEach((plane) => {
      if (
        Math.abs(normal[1]) > 0.45 ||
        Math.abs(normal[0] * plane.nx + normal[2] * plane.nz) < 0.82
      )
        return;
      const distance = group.x * plane.nx + group.z * plane.nz - plane.offset;
      if (Math.abs(distance) > 0.06) return;
      if (!best || Math.abs(distance) < Math.abs(best.distance))
        best = { plane, distance };
    });
    if (best !== null) {
      target[groupIndex][0] -= best.plane.nx * best.distance * 0.86;
      target[groupIndex][2] -= best.plane.nz * best.distance * 0.86;
    }
    if (Math.abs(normal[1]) < 0.78 || !horizontalPlanes.length) return;
    let horizontalDistance = null;
    horizontalPlanes.forEach((plane) => {
      const distance = group.y - plane.y;
      if (Math.abs(distance) > 0.055) return;
      if (
        horizontalDistance === null ||
        Math.abs(distance) < Math.abs(horizontalDistance)
      )
        horizontalDistance = distance;
    });
    if (horizontalDistance !== null)
      target[groupIndex][1] -= horizontalDistance * 0.86;
  });

  // Boundary smoothing uses the plane-corrected positions, so it cannot
  // immediately reintroduce the bowed wall it just corrected.
  const maximumEdge = 0.085;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    if (!boundary[groupIndex]) continue;
    const normal = normals[groupIndex];
    const accepted = [];
    neighbors[groupIndex].forEach((neighborIndex) => {
      if (!boundary[neighborIndex]) return;
      const neighbor = target[neighborIndex];
      const dx = neighbor[0] - target[groupIndex][0];
      const dy = neighbor[1] - target[groupIndex][1];
      const dz = neighbor[2] - target[groupIndex][2];
      if (Math.hypot(dx, dy, dz) > maximumEdge) return;
      const neighborNormal = normals[neighborIndex];
      if (
        normal[0] * neighborNormal[0] +
          normal[1] * neighborNormal[1] +
          normal[2] * neighborNormal[2] <
        0.86
      )
        return;
      accepted.push(neighbor);
    });
    if (accepted.length < 2) continue;
    const average = accepted.reduce(
      (value, neighbor) => ({
        x: value.x + neighbor[0] / accepted.length,
        y: value.y + neighbor[1] / accepted.length,
        z: value.z + neighbor[2] / accepted.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
    let dx = average.x - target[groupIndex][0];
    let dy = average.y - target[groupIndex][1];
    let dz = average.z - target[groupIndex][2];
    // Only slide along the captured surface. The normal component is what
    // would flatten a recess or pull an open boundary toward its neighbors.
    const normalDistance = dx * normal[0] + dy * normal[1] + dz * normal[2];
    dx -= normalDistance * normal[0];
    dy -= normalDistance * normal[1];
    dz -= normalDistance * normal[2];
    const displacement = Math.hypot(dx, dy, dz);
    const limit = 0.012;
    const scale = Math.min(0.2, limit / Math.max(limit, displacement));
    target[groupIndex][0] += dx * scale;
    target[groupIndex][1] += dy * scale;
    target[groupIndex][2] += dz * scale;
  }
  const positions = new Float32Array(mesh.positions);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const group = target[vertexGroups[vertex]];
    const offset = vertex * 3;
    positions[offset] = group[0];
    positions[offset + 1] = group[1];
    positions[offset + 2] = group[2];
  }
  return positions;
}

export default function ScanMesh({ mesh, low = false }) {
  const resources = useMemo(() => {
    const value = new THREE.BufferGeometry();
    const positions = stabilizeRenderableBoundary(mesh);
    value.setAttribute(
      "position",
      new THREE.BufferAttribute(positions || mesh.positions, 3),
    );
    value.setAttribute(
      "color",
      new THREE.BufferAttribute(mesh.colors, 3, true),
    );
    if (mesh.uvs)
      value.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    if (mesh.normals && positions === mesh.positions)
      value.setAttribute(
        "normal",
        new THREE.BufferAttribute(mesh.normals, 3),
      );
    value.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    // Boundary/plane stabilization changes the rendered positions. Reusing
    // pre-stabilization normals makes portable (untextured) scans show false
    // dark bands, so derive normals from the exact vertices on screen.
    if (!mesh.normals || positions !== mesh.positions)
      value.computeVertexNormals();
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
      // The texture is an atlas of independently exposed camera frames. A
      // mip level would average neighboring tiles (and their gutters) before
      // the sampler ever sees the triangle's UV, producing pale seams and
      // gray/white color bleeding on the measured surface.
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
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
          // Untextured triangles use the atlas' white fallback tile and their
          // captured vertex color. Keep vertex colors enabled for that path;
          // textured triangles are neutral white and remain unchanged.
          vertexColors
          map={resources.texture}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      ) : mesh.portableColors ? (
        <meshBasicMaterial
          vertexColors
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
