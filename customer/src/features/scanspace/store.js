import { create } from "zustand";
import { clone, normalizeRoom, rectangle } from "./core/domain";

export const useScanSpace = create((set, get) => ({
  room: null,
  original: null,
  history: [],
  future: [],
  selected: "wall-0",
  mode: "orbit",
  before: false,
  textures: {},
  scanCloud: null,
  showCapture: false,
  projectId: null,
  revision: 1,
  setRoom(raw, extras = {}) {
    const room = normalizeRoom(raw);
    set({
      room,
      original: clone(room),
      history: [],
      future: [],
      selected: "wall-0",
      before: false,
      textures: {},
      scanCloud: null,
      showCapture: false,
      projectId: null,
      revision: 1,
      ...extras,
    });
  },
  edit(change) {
    const state = get(),
      next = clone(state.room);
    change(next);
    const room = normalizeRoom(next);
    set({
      room,
      history: [...state.history.slice(-39), state.room],
      future: [],
      before: false,
    });
  },
  undo() {
    const s = get();
    if (s.history.length)
      set({
        room: s.history[s.history.length - 1],
        history: s.history.slice(0, -1),
        future: [s.room, ...s.future].slice(0, 40),
      });
  },
  redo() {
    const s = get();
    if (s.future.length)
      set({
        room: s.future[0],
        history: [...s.history, s.room].slice(-40),
        future: s.future.slice(1),
      });
  },
  select(selected) {
    set({ selected });
  },
  setMode(mode) {
    set({ mode });
  },
  toggleBefore() {
    set({ before: !get().before });
  },
  resetDesign() {
    const s = get();
    set({
      room: clone(s.original),
      history: [...s.history.slice(-39), s.room],
      future: [],
    });
  },
  update(values) {
    set(values);
  },
}));

export function sampleRoom() {
  const room = rectangle(4.8, 4, 2.7);
  room.name = "Studio living room";
  room.scanMetadata.mode = "sample";
  room.walls[0].material.color = "#a0afa4";
  room.walls[1].material.color = "#eee8dd";
  room.walls[2].material.color = "#eee8dd";
  room.walls[3].material.color = "#eee8dd";
  room.walls[0].openings = [
    {
      id: "demo-window",
      type: "window",
      offset: 1.6,
      bottom: 1,
      width: 1.6,
      height: 1.25,
    },
  ];
  room.walls[2].openings = [
    {
      id: "demo-door",
      type: "door",
      offset: 0.35,
      bottom: 0,
      width: 0.9,
      height: 2.1,
    },
  ];
  room.floorMaterial = {
    ...room.floorMaterial,
    kind: "wood",
    color: "#b99d7a",
    tileSize: 0.22,
  };
  room.placedProducts = [
    {
      id: "demo-sofa",
      productId: "",
      name: "Sample sofa",
      modelUrl: "/scanspace/models/sofa.glb",
      position: { x: 2.4, y: 0, z: 0.8 },
      rotation: 0,
      dimensions: { width: 2.3, height: 0.85, depth: 0.9 },
      color: "#bb7756",
    },
    {
      id: "demo-table",
      productId: "",
      name: "Sample coffee table",
      modelUrl: "/scanspace/models/table.glb",
      position: { x: 2.4, y: 0, z: 2.1 },
      rotation: 0,
      dimensions: { width: 1.15, height: 0.42, depth: 0.6 },
      color: "#886444",
    },
    {
      id: "demo-cabinet",
      productId: "",
      name: "Sample sideboard",
      modelUrl: "/scanspace/models/cabinet.glb",
      position: { x: 4.35, y: 0, z: 2.1 },
      rotation: Math.PI / 2,
      dimensions: { width: 1.5, height: 0.85, depth: 0.45 },
      color: "#b2956e",
    },
  ];
  return normalizeRoom(room);
}
