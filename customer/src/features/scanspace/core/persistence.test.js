import { saveDraft, loadDraft } from "../services";
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
