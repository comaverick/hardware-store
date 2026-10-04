import * as THREE from "three";
import woodColor from "../../../assets/scanspace/flooring/wood_floor_diff_1k.jpg";
import woodNormal from "../../../assets/scanspace/flooring/wood_floor_nor_gl_1k.jpg";
import woodRoughness from "../../../assets/scanspace/flooring/wood_floor_rough_1k.jpg";
import stoneColor from "../../../assets/scanspace/flooring/floor_tiles_04_diff_1k.jpg";
import stoneNormal from "../../../assets/scanspace/flooring/floor_tiles_04_nor_gl_1k.jpg";
import stoneRoughness from "../../../assets/scanspace/flooring/floor_tiles_04_rough_1k.jpg";
import { floorFinishes } from "./scanCustomization";

const wood = { urls: [woodColor, woodNormal, woodRoughness], metres: 1.7,
  // The photographs' linear mean colors, before any finish tint or room light.
  reference: [.217614, .117465, .055411], rotation: Math.PI / 2 };
const stone = { urls: [stoneColor, stoneNormal, stoneRoughness], metres: 2.4,
  reference: [.572129, .382307, .192417], rotation: 0 };
const finishes = {
  oak: { source: wood, roughness: .9, minimumRoughness: .38, relief: .3 },
  walnut: { source: wood, roughness: .85, minimumRoughness: .34, relief: .3 },
  stone: { source: stone, roughness: 1, minimumRoughness: .6, relief: .35 },
  "light-vinyl": { source: wood, roughness: .95, minimumRoughness: .48, relief: .12 },
};
// Cache decoded photographs, not GPU textures. Each active finish owns and
// disposes its texture copies, including when the pattern direction changes.
const images = new Map();

function loadImage(url) {
  if (!images.has(url)) {
    const pending = new Promise((resolve, reject) => new THREE.ImageLoader().load(url, resolve, undefined, reject));
    images.set(url, pending);
    pending.catch(() => { if (images.get(url) === pending) images.delete(url); });
  }
  return images.get(url);
}

export function createFloorFinishMaterial(selection, photographs) {
  const definition = finishes[selection?.finishId];
  const finish = floorFinishes.find(value => value.id === selection?.finishId);
  if (!definition || !finish || photographs?.length !== 3) return null;
  const { source } = definition;
  const rotation = source.rotation + (selection.direction === "crosswise" ? Math.PI / 2 : 0);
  const textures = photographs.map((image, index) => {
    const texture = new THREE.Texture(image);
    texture.colorSpace = index ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.channel = 1;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.repeat.set(1 / source.metres, 1 / source.metres);
    texture.rotation = rotation;
    texture.needsUpdate = true;
    return texture;
  });
  // Change the finish's base tone while retaining photographed grain, knots,
  // mineral detail and individual board/tile variation in linear color.
  const selected = new THREE.Color(finish.color);
  const color = new THREE.Color().setRGB(selected.r / source.reference[0],
    selected.g / source.reference[1], selected.b / source.reference[2]);
  let disposed = false;
  return { finishId: selection.finishId, direction: selection.direction,
    map: textures[0], normalMap: textures[1], roughnessMap: textures[2], color,
    roughness: definition.roughness, minimumRoughness: definition.minimumRoughness,
    normalScale: new THREE.Vector2(definition.relief, definition.relief),
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return;
      disposed = true;
      textures.forEach(texture => texture.dispose());
    },
  };
}

export async function loadFloorFinishMaterial(selection) {
  const definition = finishes[selection?.finishId];
  if (!definition) return null;
  const photographs = await Promise.all(definition.source.urls.map(loadImage));
  return createFloorFinishMaterial(selection, photographs);
}
