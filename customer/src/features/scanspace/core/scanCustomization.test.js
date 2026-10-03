import { finishSelections, paintRoughness, sanitizeScanCustomization } from "./scanCustomization";

test("imported finishes accept only supported colors, sheen, flooring and direction", () => {
  expect(sanitizeScanCustomization({ version: 1,
    walls: { color: "#A0AFA4", finish: "Satin", arbitrary: true },
    floor: { finishId: "unknown", direction: "crosswise" },
    ceiling: { color: "bad", finish: "Matte" },
  })).toEqual({ version: 1, walls: { color: "#a0afa4", finish: "Satin" } });
  expect(sanitizeScanCustomization({ version: 2, floor: { finishId: "oak", direction: "lengthwise" } })).toBeNull();
});

test("saved choices restore without pre-applying defaults to other surfaces", () => {
  const saved = { version: 1, walls: { color: "#53665b", finish: "Eggshell" } };
  expect(finishSelections(saved).walls).toEqual(saved.walls);
  expect(finishSelections(saved).floor.finishId).toBe("oak");
  expect(saved.floor).toBeUndefined();
  expect(paintRoughness("Satin")).toBeLessThan(paintRoughness("Matte"));
});
