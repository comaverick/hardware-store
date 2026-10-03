export const floorFinishes = [
  { id: "oak", name: "Natural oak", kind: "Wood", pattern: "plank", color: "#b99d7a" },
  { id: "walnut", name: "Walnut", kind: "Wood", pattern: "plank", color: "#765641" },
  { id: "stone", name: "Soft stone", kind: "Tile", pattern: "tile", color: "#c5c7c2" },
  { id: "light-vinyl", name: "Light oak", kind: "Vinyl", pattern: "plank", color: "#d1bb95" },
];
export const defaultFinishSelections = () => ({
  walls: { color: "#eee8dd", finish: "Matte" },
  floor: { finishId: "oak", direction: "lengthwise" },
  ceiling: { color: "#ffffff", finish: "Matte" },
});

export function sanitizeScanCustomization(value) {
  if (!value || value.version !== 1) return null;
  const result = { version: 1 };
  for (const kind of ["walls", "ceiling"]) {
    const paint = value[kind];
    if (typeof paint?.color === "string" && /^#[0-9a-f]{6}$/i.test(paint.color) &&
      ["Matte", "Eggshell", "Satin"].includes(paint.finish))
      result[kind] = { color: paint.color.toLowerCase(), finish: paint.finish };
  }
  if (floorFinishes.some(finish => finish.id === value.floor?.finishId) &&
    ["lengthwise", "crosswise"].includes(value.floor?.direction))
    result.floor = { finishId: value.floor.finishId, direction: value.floor.direction };
  return result.walls || result.floor || result.ceiling ? result : null;
}

export function finishSelections(customization) {
  const applied = sanitizeScanCustomization(customization);
  return { ...defaultFinishSelections(), ...applied };
}

export const paintRoughness = finish => ({ Matte: 1, Eggshell: .78, Satin: .5 })[finish] ?? 1;
