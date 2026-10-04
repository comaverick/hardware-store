import * as THREE from "three";
import { createFloorFinishMaterial, loadFloorFinishMaterial } from "./scanFloorMaterial";
import { floorFinishes } from "./scanCustomization";

const photographs = [{ width: 1024, height: 1024 }, { width: 1024, height: 1024 }, { width: 1024, height: 1024 }];

test("photographed color, relief and roughness share a physically scaled UV channel", () => {
  const material = createFloorFinishMaterial({ finishId: "oak", direction: "lengthwise" }, photographs);
  const rotated = createFloorFinishMaterial({ finishId: "oak", direction: "crosswise" }, photographs);
  for (const [index, texture] of [material.map, material.normalMap, material.roughnessMap].entries()) {
    expect(texture.image).toBe(photographs[index]);
    expect(texture.channel).toBe(1);
    expect(texture.repeat.toArray()).toEqual([1 / 1.7, 1 / 1.7]);
    expect(texture.rotation).toBe(material.map.rotation);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.anisotropy).toBe(4);
    expect(texture.colorSpace).toBe(index ? THREE.NoColorSpace : THREE.SRGBColorSpace);
  }
  expect(rotated.map.rotation - material.map.rotation).toBeCloseTo(Math.PI / 2);
  expect(rotated.normalMap.rotation).toBe(rotated.map.rotation);
  expect(rotated.roughnessMap.rotation).toBe(rotated.map.rotation);
  const stone = createFloorFinishMaterial({ finishId: "stone", direction: "lengthwise" }, photographs);
  expect(stone.map.repeat.toArray()).toEqual([1 / 2.4, 1 / 2.4]);
  expect(stone.minimumRoughness).toBeGreaterThan(material.minimumRoughness);
  material.dispose(); rotated.dispose(); stone.dispose();
});

test("finish tint removes the source base tone while retaining its photographic detail", () => {
  for (const finish of floorFinishes) {
    const material = createFloorFinishMaterial({ finishId: finish.id, direction: "lengthwise" }, photographs);
    const expected = new THREE.Color(finish.color);
    const reference = finish.pattern === "tile" ? [.572129, .382307, .192417] : [.217614, .117465, .055411];
    for (const [index, channel] of ["r", "g", "b"].entries())
      expect(material.color[channel] * reference[index]).toBeCloseTo(expected[channel], 6);
    expect(material.map.image).toBe(photographs[0]);
    expect(material.normalScale.x).toBeLessThan(.5);
    material.dispose();
  }
  expect(createFloorFinishMaterial({ finishId: "unknown" }, photographs)).toBeNull();
});

test("a material releases all of its GPU maps once and exposes its disposed state", () => {
  const material = createFloorFinishMaterial({ finishId: "walnut", direction: "crosswise" }, photographs);
  const dispose = [material.map, material.normalMap, material.roughnessMap].map(texture => jest.spyOn(texture, "dispose"));
  expect(material.disposed).toBe(false);
  material.dispose(); material.dispose();
  expect(material.disposed).toBe(true);
  dispose.forEach(spy => expect(spy).toHaveBeenCalledTimes(1));
});

test("decoded photographs are reused, GPU maps are independent, and failed images can retry", async () => {
  const loader = jest.spyOn(THREE.ImageLoader.prototype, "load").mockImplementation((url, resolve) => {
    resolve({ width: 1024, height: 1024, src: url });
  });
  try {
    const oak = await loadFloorFinishMaterial({ finishId: "oak", direction: "lengthwise" });
    const walnut = await loadFloorFinishMaterial({ finishId: "walnut", direction: "crosswise" });
    expect(loader).toHaveBeenCalledTimes(3);
    expect(walnut.map.image).toBe(oak.map.image);
    expect(walnut.map).not.toBe(oak.map);
    oak.dispose();
    expect(walnut.disposed).toBe(false);
    expect(walnut.map.image.width).toBe(1024);
    loader.mockImplementationOnce((url, resolve, progress, reject) => reject(new Error("image unavailable")));
    await expect(loadFloorFinishMaterial({ finishId: "stone", direction: "lengthwise" })).rejects.toThrow("image unavailable");
    const stone = await loadFloorFinishMaterial({ finishId: "stone", direction: "lengthwise" });
    expect(loader).toHaveBeenCalledTimes(7);
    expect(stone.map.image.width).toBe(1024);
    walnut.dispose(); stone.dispose();
  } finally { loader.mockRestore(); }
});
