import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  FloppyDisk,
  PaintRoller,
  Cube,
  Ruler,
  ShoppingCart,
  ArrowLeft,
  Eye,
  X,
  Plus,
  Trash,
  Copy,
} from "@phosphor-icons/react";
import { useScanSpace } from "../store";
import {
  clone,
  estimateRoom,
  surfaceAreas,
  roomCenter,
  placementValid,
  material,
} from "../core/domain";
import { api, saveDraft, captureStore } from "../services";
import { sampleCatalog, sampleInventory } from "../sampleCatalog";
import {
  acceptScanSpaceCart,
  useReservationCart,
} from "../../../cart/reservationCart";
import RoomReview from "./RoomReview";
const RoomScene = lazy(() => import("./RoomScene"));
const money = (value) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);
const colors = [
  "#eee8dd",
  "#a0afa4",
  "#b3c0c7",
  "#d9b09a",
  "#e5d3a4",
  "#53665b",
  "#424e55",
  "#ffffff",
];
export default function RoomEditor({ onExit }) {
  const s = useScanSpace(),
    [tab, setTab] = useState("surfaces"),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [catalog, setCatalog] = useState([]),
    [branches, setBranches] = useState([]),
    [inventory, setInventory] = useState([]),
    [branch, setBranch] = useState(""),
    [demo, setDemo] = useState(
      () =>
        s.room.scanMetadata.mode === "sample" ||
        s.room.walls.some((w) => w.material.productId.startsWith("sample-")) ||
        s.room.floorMaterial.productId.startsWith("sample-"),
    ),
    [estimate, setEstimate] = useState(null),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [reset, setReset] = useState(0),
    [snap, setSnap] = useState(true),
    [snapWall, setSnapWall] = useState(false),
    [saveColors, setSaveColors] = useState(false),
    [projectList, setProjectList] = useState(null);
  const current = useRef(s.room);
  current.current = s.room;
  const loading = useRef(0);
  const reportError = useCallback((message) => setError(message), []);
  const change = useCallback((fn) => {
    try {
      useScanSpace.getState().edit(fn);
      setError("");
      setEstimate(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  const move = useCallback(
    (id, position) =>
      change((r) => {
        r.placedProducts.find((o) => o.id === id).position = position;
      }),
    [change],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        saveDraft(s.room);
      } catch {
        setNotice(
          "Browser storage is full. Save a cloud project or export your room.",
        );
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [s.room]);
  useEffect(() => {
    let active = true;
    const version = ++loading.current;
    setEstimate(null);
    if (demo) {
      setCatalog(sampleCatalog);
      setInventory(sampleInventory);
      return;
    }
    api(`/catalog${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`)
      .then((data) => {
        if (active && version === loading.current) {
          setCatalog(data.products);
          setBranches(data.branches);
          setInventory(data.inventory);
        }
      })
      .catch(() => {
        if (active) {
          setCatalog([]);
          setError(
            "Store catalog could not load. You can keep designing or try the labelled sample catalog.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [branch, demo]);
  useEffect(() => {
    setEstimate(null);
  }, [s.room]);
  const selectedWall = s.room.walls.find((w) => w.id === s.selected),
    object = s.room.placedProducts.find((o) => o.id === s.selected),
    surface =
      s.selected === "floor" ? s.room.floorMaterial : selectedWall?.material,
    areas = surfaceAreas(s.room);
  const chooseMaterial = (values) =>
    change((r) => {
      if (s.selected === "floor")
        r.floorMaterial = material({ ...r.floorMaterial, ...values });
      else {
        const w = r.walls.find((w) => w.id === s.selected);
        if (w) w.material = material({ ...w.material, ...values });
      }
    });
  const applyProduct = (p) => {
    const m = p.scanSpace;
    if (m.materialType === "object") return addObject(p);
    chooseMaterial({
      productId: p._id,
      color: m.color || "#e6e1d8",
      kind: m.materialType,
      textureUrl: m.textureUrl || "",
      tileSize: m.tileSize || 0.6,
      coats: m.recommendedCoats || 2,
      waste: m.wastePercentage ?? 0.1,
    });
  };
  function addObject(p) {
    const d = p.scanSpace.modelDimensions;
    if (!d?.width || !d.height || !d.depth) {
      setError(
        "This product needs its real dimensions before it can be placed.",
      );
      return;
    }
    const c = roomCenter(s.room),
      item = {
        id: crypto.randomUUID(),
        productId: p._id,
        name: p.name,
        modelUrl: p.scanSpace.glbModelUrl || "",
        position: { ...c, y: 0 },
        rotation: 0,
        dimensions: d,
        color: p.scanSpace.color || "#ad8563",
      };
    change((r) => {
      r.placedProducts.push(item);
    });
    if (placementValid(item, s.room.floorPolygon)) {
      s.select(item.id);
      s.setMode("top");
    }
  }
  async function calculate(add = false) {
    setBusy(true);
    setError("");
    const room = current.current;
    try {
      let result;
      if (demo) {
        result = estimateRoom(room, catalog, inventory);
      } else {
        if (!branch)
          throw new Error("Choose a pickup branch to get a live estimate.");
        result = await api(add ? "/cart-lines" : "/estimate", { room, branch });
      }
      if (room !== current.current)
        throw new Error(
          "The room changed while calculating. Please estimate again.",
        );
      setEstimate(result);
      if (add) {
        if (demo)
          throw new Error(
            "Sample products cannot be reserved. Switch to the store catalog.",
          );
        setNotice(await acceptScanSpaceCart(result));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    const room = current.current;
    try {
      saveDraft(room);
      if (saveColors && Object.keys(s.textures).length)
        await captureStore("put", {
          outline: JSON.stringify(room.floorPolygon),
          textures: s.textures,
        });
      else await captureStore("delete");
      const result = await api(
        s.projectId ? `/projects/${s.projectId}` : "/projects",
        { room, revision: s.revision },
        s.projectId ? "PATCH" : "POST",
      );
      s.update({ projectId: result._id, revision: result.revision });
      setNotice(
        "Project saved privately. Cloud projects expire after 90 days without saving.",
      );
    } catch (e) {
      setError(
        `Local draft saved when storage is available. Cloud save: ${e.message}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function openProjects() {
    setBusy(true);
    try {
      setProjectList(await api("/projects"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function loadProject(p) {
    try {
      const data = await api(`/projects/${p._id}`);
      s.setRoom(data.room, { projectId: data._id, revision: data.revision });
      setProjectList(null);
    } catch (e) {
      setError(e.message);
    }
  }
  function exportRoom() {
    const blob = new Blob([JSON.stringify(s.room, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "scanspace-room.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (review)
    return (
      <div className="ss-app">
        <RoomReview
          initial={s.room}
          onCancel={() => setReview(false)}
          onComplete={(room) => {
            change((r) => Object.assign(r, room));
            s.update({ textures: {}, scanCloud: null, showCapture: false });
            setReview(false);
            setReset((v) => v + 1);
          }}
        />
      </div>
    );
  const shown = s.before ? s.original : s.room;
  return (
    <div className="ss-editor">
      <header className="ss-editor-header">
        <a href="/" className="ss-brand">
          Scan<span>Space</span>
        </a>
        <span className="ss-room-name">
          {s.room.name}
          <small>
            {areas.floor.toFixed(1)} m² ·{" "}
            {s.room.scanMetadata.mode === "sample"
              ? "Sample room"
              : s.room.scanMetadata.mode === "depth"
                ? "Depth capture"
                : s.room.scanMetadata.mode === "assisted"
                  ? "Assisted capture"
                  : "Measured room"}
          </small>
        </span>
        <div className="ss-editor-actions">
          <button
            title="Undo"
            aria-label="Undo"
            disabled={!s.history.length}
            onClick={s.undo}
          >
            <ArrowCounterClockwise size={19} />
          </button>
          <button
            title="Redo"
            aria-label="Redo"
            disabled={!s.future.length}
            onClick={s.redo}
          >
            <ArrowClockwise size={19} />
          </button>
          <button
            disabled={busy}
            onClick={save}
            className="ss-primary"
            aria-label="Save project"
          >
            <FloppyDisk size={18} />
            <span>Save</span>
          </button>
        </div>
      </header>
      <div className="ss-editor-body">
        <div className="ss-viewport">
          <div className="ss-viewbar">
            <div role="group" aria-label="Room view">
              {[
                ["orbit", "Dollhouse"],
                ["top", "Top down"],
                ["first", "Walk inside"],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  aria-pressed={s.mode === mode}
                  className={s.mode === mode ? "is-active" : ""}
                  onClick={() => s.setMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              title="Reset camera"
              aria-label="Reset camera"
              onClick={() => setReset((v) => v + 1)}
            >
              <ArrowCounterClockwise size={18} />
            </button>
          </div>
          <Suspense
            fallback={<div className="ss-loading">Preparing your room…</div>}
          >
            <RoomScene
              room={shown}
              mode={s.mode}
              selected={s.before ? null : s.selected}
              onSelect={s.select}
              onMove={move}
              textures={s.textures}
              showCapture={s.showCapture}
              scanCloud={s.scanCloud}
              showScan={s.before && !!s.scanCloud}
              onError={reportError}
              reset={reset}
              snap={snap}
              snapWall={snapWall}
            />
          </Suspense>
          <button
            className={`ss-before ${s.before ? "is-active" : ""}`}
            onClick={s.toggleBefore}
          >
            <Eye size={16} />
            {s.before
              ? s.scanCloud
                ? "Viewing scan"
                : "Viewing original"
              : "Before & after"}
          </button>
          {s.before && (
            <div className="ss-before-label">
              {s.scanCloud ? "Captured room" : "Original design"}
            </div>
          )}
        </div>
        <aside className="ss-inspector">
          <nav className="ss-editor-tabs" aria-label="Editor tools">
            {[
              ["surfaces", PaintRoller, "Surfaces"],
              ["objects", Cube, "Objects"],
              ["measure", Ruler, "Room"],
              ["estimate", ShoppingCart, "Estimate"],
            ].map(([id, Icon, label]) => (
              <button
                key={id}
                aria-pressed={tab === id}
                className={tab === id ? "is-active" : ""}
                onClick={() => setTab(id)}
              >
                <Icon size={21} />
                {label}
              </button>
            ))}
          </nav>
          <div className="ss-panel-content">
            {notice && (
              <div className="ss-notice" role="status">
                {notice}
                <button
                  aria-label="Dismiss notice"
                  onClick={() => setNotice("")}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {error && (
              <div className="ss-error" role="alert">
                {error}
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  <X size={14} />
                </button>
              </div>
            )}
            {tab === "surfaces" && (
              <>
                <h2>A new look, one surface at a time.</h2>
                <p className="ss-small">
                  Choose a wall or the floor, then try a finish.
                </p>
                <label>
                  Selected surface
                  <select
                    value={object ? "" : s.selected}
                    onChange={(e) => s.select(e.target.value)}
                  >
                    <option value="" disabled>
                      Select a surface
                    </option>
                    {s.room.walls.map((w, i) => (
                      <option key={w.id} value={w.id}>
                        Wall {i + 1}
                      </option>
                    ))}
                    <option value="floor">Floor</option>
                  </select>
                </label>
                {surface && (
                  <>
                    <div className="ss-swatches">
                      {colors.map((color) => (
                        <button
                          key={color}
                          aria-label={`Apply ${color}`}
                          aria-pressed={surface.color === color}
                          style={{ background: color }}
                          onClick={() =>
                            chooseMaterial({
                              color,
                              productId: "",
                              textureUrl: "",
                            })
                          }
                        />
                      ))}
                    </div>
                    <label>
                      Custom color
                      <input
                        type="color"
                        value={surface.color}
                        onChange={(e) =>
                          chooseMaterial({
                            color: e.target.value,
                            productId: "",
                            textureUrl: "",
                          })
                        }
                      />
                    </label>
                    {s.selected === "floor" && (
                      <div className="ss-inline">
                        <label>
                          Finish
                          <select
                            value={surface.kind}
                            onChange={(e) =>
                              chooseMaterial({
                                kind: e.target.value,
                                productId: "",
                                textureUrl: "",
                              })
                            }
                          >
                            <option value="wood">Wood</option>
                            <option value="tile">Tile</option>
                            <option value="vinyl">Vinyl</option>
                          </select>
                        </label>
                        <label>
                          Tile / plank size (m)
                          <input
                            type="number"
                            step="0.05"
                            min="0.05"
                            max="5"
                            value={surface.tileSize}
                            onChange={(e) =>
                              chooseMaterial({
                                tileSize: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Direction
                          <select
                            value={surface.rotation}
                            onChange={(e) =>
                              chooseMaterial({
                                rotation: Number(e.target.value),
                              })
                            }
                          >
                            {[0, 45, 90, 135].map((n) => (
                              <option key={n} value={n}>
                                {n}°
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                    {selectedWall && (
                      <button
                        onClick={() =>
                          change((r) => {
                            r.walls.forEach((w) => {
                              w.material = clone(surface);
                            });
                          })
                        }
                      >
                        Apply finish to all walls
                      </button>
                    )}
                    <h3>
                      {demo ? "Sample supplies" : "Choose a store product"}
                    </h3>
                    <p className="ss-small">
                      Color swatches are previews. Select a product to include
                      it in your material estimate.
                    </p>
                    <Catalog
                      products={catalog.filter((p) =>
                        s.selected === "floor"
                          ? ["wood", "tile", "vinyl"].includes(
                              p.scanSpace.materialType,
                            )
                          : p.scanSpace.materialType === "paint",
                      )}
                      onChoose={applyProduct}
                      selected={surface.productId}
                      demo={demo}
                    />
                  </>
                )}
                {!!Object.keys(s.textures).length && (
                  <label className="ss-check">
                    <input
                      type="checkbox"
                      checked={s.showCapture}
                      onChange={(e) =>
                        s.update({ showCapture: e.target.checked })
                      }
                    />
                    Show captured wall colors
                  </label>
                )}
              </>
            )}
            {tab === "objects" && (
              <>
                <h2>Find its place.</h2>
                <p className="ss-small">
                  Use top-down view to drag objects into position. Dimensions
                  come from each product.
                </p>
                <div className="ss-inline">
                  <label className="ss-check">
                    <input
                      type="checkbox"
                      checked={snap}
                      onChange={(e) => setSnap(e.target.checked)}
                    />
                    Snap to 10 cm grid
                  </label>
                  <label className="ss-check">
                    <input
                      type="checkbox"
                      checked={snapWall}
                      onChange={(e) => setSnapWall(e.target.checked)}
                    />
                    Snap near walls
                  </label>
                </div>
                {!!s.room.placedProducts.length && (
                  <label>
                    Placed object
                    <select
                      value={object?.id || ""}
                      onChange={(e) => s.select(e.target.value)}
                    >
                      <option value="">Select an object</option>
                      {s.room.placedProducts.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {object && (
                  <div className="ss-object-properties">
                    <h3>{object.name}</h3>
                    <div className="ss-inline">
                      {["x", "z", "y"].map((axis) => (
                        <label key={axis}>
                          {axis.toUpperCase()} (m)
                          <input
                            type="number"
                            step="0.1"
                            value={
                              Math.round(object.position[axis] * 100) / 100
                            }
                            onChange={(e) =>
                              change((r) => {
                                r.placedProducts.find(
                                  (o) => o.id === object.id,
                                ).position[axis] = Number(e.target.value);
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <label>
                      Rotation
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        step="5"
                        value={Math.round((object.rotation * 180) / Math.PI)}
                        onChange={(e) =>
                          change((r) => {
                            r.placedProducts.find(
                              (o) => o.id === object.id,
                            ).rotation =
                              (Number(e.target.value) * Math.PI) / 180;
                          })
                        }
                      />
                    </label>
                    <p className="ss-small">
                      {object.dimensions.width} × {object.dimensions.depth} ×{" "}
                      {object.dimensions.height} m
                    </p>
                    <div className="ss-actions">
                      <button
                        onClick={() =>
                          change((r) => {
                            const item = clone(object);
                            item.id = crypto.randomUUID();
                            item.position.x += 0.2;
                            item.position.z += 0.2;
                            r.placedProducts.push(item);
                          })
                        }
                      >
                        <Copy size={16} />
                        Duplicate
                      </button>
                      <button
                        onClick={() => {
                          change((r) => {
                            r.placedProducts = r.placedProducts.filter(
                              (o) => o.id !== object.id,
                            );
                          });
                          s.select("floor");
                        }}
                      >
                        <Trash size={16} />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
                <h3>
                  {demo ? "Sample objects" : "Store furniture & fixtures"}
                </h3>
                <Catalog
                  products={catalog.filter(
                    (p) => p.scanSpace.materialType === "object",
                  )}
                  onChoose={addObject}
                  demo={demo}
                />
              </>
            )}
            {tab === "measure" && (
              <>
                <h2>Your room, measured.</h2>
                <div className="ss-room-totals">
                  <span>
                    <strong>{areas.floor.toFixed(2)} m²</strong>floor area
                  </span>
                  <span>
                    <strong>{areas.wallNet.toFixed(2)} m²</strong>paintable
                    walls
                  </span>
                </div>
                <p className="ss-small">
                  Height: {s.room.ceilingHeight.toFixed(2)} m ·{" "}
                  {s.room.walls.length} walls
                </p>
                <button onClick={() => setReview(true)}>
                  <Ruler size={17} />
                  Edit measurements & openings
                </button>
                <button disabled={busy} onClick={openProjects}>
                  Open cloud project
                </button>
                <button onClick={exportRoom}>Export room JSON</button>
                <button onClick={s.resetDesign}>
                  Reset design to original
                </button>
                <button onClick={onExit}>
                  <ArrowLeft size={17} />
                  New room or scan
                </button>
                <label className="ss-check">
                  <input
                    type="checkbox"
                    checked={saveColors}
                    onChange={(e) => setSaveColors(e.target.checked)}
                  />
                  Save captured colors on this device
                </label>
                <p className="ss-small">
                  Geometry saves to your private cloud project. Camera textures
                  stay on this device. Browser storage can be cleared by your
                  browser.
                </p>
                <details>
                  <summary>Scan information</summary>
                  <dl>
                    {Object.entries(s.room.scanMetadata).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </>
            )}
            {tab === "estimate" && (
              <>
                <h2>From room to reservation.</h2>
                <p className="ss-small">
                  Choose products in Surfaces and Objects. Quantities include
                  the allowance you set below.
                </p>
                {!demo && (
                  <label>
                    Pickup branch
                    <select
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                    >
                      <option value="">Choose a branch</option>
                      {branches.map((b) => (
                        <option key={b._id} value={b._id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="ss-inline">
                  <label>
                    Coats on all walls
                    <input
                      type="number"
                      min="1"
                      max="6"
                      step="1"
                      value={s.room.walls[0].material.coats}
                      onChange={(e) =>
                        change((r) =>
                          r.walls.forEach((w) => {
                            w.material.coats = Number(e.target.value);
                          }),
                        )
                      }
                    />
                  </label>
                  <label>
                    Waste allowance (%)
                    <input
                      type="number"
                      min="0"
                      max="50"
                      value={Math.round(s.room.floorMaterial.waste * 100)}
                      onChange={(e) =>
                        change((r) => {
                          const n = Number(e.target.value) / 100;
                          r.walls.forEach((w) => {
                            w.material.waste = n;
                          });
                          r.floorMaterial.waste = n;
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  className="ss-primary"
                  disabled={busy}
                  onClick={() => calculate()}
                >
                  {busy ? "Calculating…" : "Calculate materials"}
                </button>
                {estimate && (
                  <>
                    <div className="ss-estimate-total">
                      <small>
                        {demo ? "Sample estimate" : "Current branch estimate"}
                      </small>
                      <strong>{money(estimate.total)}</strong>
                    </div>
                    {!estimate.items.length && (
                      <p className="ss-notice">
                        No purchasable products selected. Apply a catalog
                        product to a surface first.
                      </p>
                    )}
                    {estimate.calculations.map((c, i) => (
                      <details className="ss-calculation" key={i} open>
                        <summary>{c.name}</summary>
                        <dl>
                          <div>
                            <dt>Measured area</dt>
                            <dd>{(c.grossArea ?? c.area).toFixed(2)} m²</dd>
                          </div>
                          {c.openingArea != null && (
                            <div>
                              <dt>Doors / windows removed</dt>
                              <dd>{c.openingArea.toFixed(2)} m²</dd>
                            </div>
                          )}
                          {c.coats && (
                            <div>
                              <dt>Coats</dt>
                              <dd>{c.coats}</dd>
                            </div>
                          )}
                          <div>
                            <dt>Coverage</dt>
                            <dd>
                              {c.coverage}{" "}
                              {c.kind === "paint" ? "m²/L/coat" : "m²/pack"}
                            </dd>
                          </div>
                          <div>
                            <dt>Base requirement</dt>
                            <dd>
                              {c.rawRequirement.toFixed(2)} {c.unit}
                            </dd>
                          </div>
                          <div>
                            <dt>Allowance</dt>
                            <dd>{Math.round(c.waste * 100)}%</dd>
                          </div>
                          <div>
                            <dt>Required</dt>
                            <dd>
                              {c.required.toFixed(2)} {c.unit}
                            </dd>
                          </div>
                        </dl>
                        {c.packages && (
                          <p className="ss-small">
                            {c.packages
                              .map((p) => `${p.quantity} × ${p.volume} L`)
                              .join(" + ")}
                          </p>
                        )}
                      </details>
                    ))}
                    <ul className="ss-estimate-lines">
                      {estimate.items.map((i) => (
                        <li key={i.productId}>
                          <span>
                            {i.name}
                            <small>
                              {i.quantity} × {money(i.unitPrice)} ·{" "}
                              {demo
                                ? "Sample stock"
                                : i.inStock
                                  ? "Available"
                                  : "Insufficient stock"}
                            </small>
                          </span>
                          <strong>{money(i.total)}</strong>
                        </li>
                      ))}
                    </ul>
                    <p className="ss-small">
                      Estimate only. Confirm dimensions and the manufacturer’s
                      coverage instructions before purchase. Prices and stock
                      are rechecked when preparing your cart.
                    </p>
                    <button
                      className="ss-primary"
                      disabled={busy || demo || !estimate.canAdd}
                      onClick={() => calculate(true)}
                    >
                      <ShoppingCart size={18} />
                      Add materials to cart
                    </button>
                  </>
                )}
              </>
            )}
            {["surfaces", "objects", "estimate"].includes(tab) && (
              <div className="ss-catalog-mode">
                <label className="ss-check">
                  <input
                    type="checkbox"
                    checked={demo}
                    onChange={(e) => {
                      setDemo(e.target.checked);
                      setError("");
                    }}
                  />
                  Try sample catalog
                </label>
                {demo && (
                  <p>Demo products and prices. Samples cannot be reserved.</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
      {projectList && (
        <div className="ss-modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Saved projects"
            className="ss-project-dialog"
          >
            <header>
              <h2>Saved projects</h2>
              <button
                onClick={() => setProjectList(null)}
                aria-label="Close projects"
              >
                <X size={20} />
              </button>
            </header>
            {!projectList.length && <p>No cloud projects yet.</p>}
            {projectList.map((p) => (
              <div className="ss-project-row" key={p._id}>
                <button onClick={() => loadProject(p)}>
                  {p.name}
                  <small>{new Date(p.updatedAt).toLocaleDateString()}</small>
                </button>
                <button
                  aria-label={`Delete ${p.name}`}
                  onClick={async () => {
                    try {
                      await api(`/projects/${p._id}`, null, "DELETE");
                      setProjectList((list) =>
                        list.filter((v) => v._id !== p._id),
                      );
                      if (s.projectId === p._id) s.update({ projectId: null });
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  <Trash size={18} />
                </button>
              </div>
            ))}
          </section>
        </div>
      )}
      <button
        className="ss-cart-access"
        aria-label="Open reservation cart"
        onClick={() => useReservationCart.getState().show()}
      >
        <ShoppingCart size={21} />
      </button>
    </div>
  );
}
function Catalog({ products, onChoose, selected, demo }) {
  return !products.length ? (
    <p className="ss-empty">
      No configured products in this category yet. Try sample supplies, or ask
      the store to add product coverage and models.
    </p>
  ) : (
    <div className="ss-catalog">
      {products.map((p) => (
        <button
          key={p._id}
          className={selected === p._id ? "is-selected" : ""}
          onClick={() => onChoose(p)}
        >
          <span
            className={`ss-product-swatch ${p.scanSpace.materialType === "object" ? "is-object" : ""}`}
            style={{ background: p.scanSpace.color || "#e5e0d7" }}
          >
            {p.scanSpace.materialType === "object" && <Cube size={22} />}
          </span>
          <span>
            <strong>{p.name}</strong>
            <small>
              {demo ? "Sample · " : ""}
              {money(p.sellingPrice)}
            </small>
          </span>
          <Plus size={17} />
        </button>
      ))}
    </div>
  );
}
