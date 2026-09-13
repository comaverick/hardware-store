import {
  loadDraft,
  looksLikeScanDiagnostics,
  MAX_ROOM_IMPORT_BYTES,
  parseRoomImport,
  saveDraft,
} from "../services";
import { sampleRoom, useScanSpace } from "../store";
import { normalizeRoom } from "./domain";
test("saved rooms survive serialization", () => {
  const room = sampleRoom();
  saveDraft(room);
  expect(loadDraft()).toEqual(normalizeRoom(room));
});
test("editor history is bounded and undo/redo retains geometry", () => {
  const store = useScanSpace.getState();
  store.setRoom(sampleRoom());
  for (let i = 0; i < 50; i++)
    store.edit((r) => {
      r.name = `Room ${i}`;
    });
  expect(useScanSpace.getState().history).toHaveLength(40);
  store.undo();
  expect(useScanSpace.getState().room.name).toBe("Room 48");
  store.redo();
  expect(useScanSpace.getState().room.name).toBe("Room 49");
});

test("room imports accept exports over 500 KB and reject diagnostics", () => {
  const room = sampleRoom();
  const exportValue = JSON.stringify({
    ...room,
    legacyUnusedData: "x".repeat(600000),
  });
  const exportSize = new Blob([exportValue]).size;
  expect(exportSize).toBeGreaterThan(512000);
  expect(MAX_ROOM_IMPORT_BYTES).toBeGreaterThan(exportSize);
  expect(parseRoomImport(exportValue)).toEqual(normalizeRoom(room));
  expect(
    looksLikeScanDiagnostics(
      "scanspace-debug-123.json",
      '{"capture":{"version":4',
    ),
  ).toBe(true);
  expect(() =>
    parseRoomImport('{"capture":{"version":4,"keyframes":[]}}'),
  ).toThrow(/diagnostics file/i);
});
