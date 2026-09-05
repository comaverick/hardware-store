import { useState } from "react";
import {
  clone,
  normalizeRoom,
  distance,
  surfaceAreas,
  rectangle,
} from "../core/domain";

export default function RoomReview({ initial, onComplete, onCancel }) {
  const [draft, setDraft] = useState(() => clone(initial || rectangle())),
    [error, setError] = useState("");
  const change = (fn) => {
    setDraft((prev) => {
      const r = clone(prev);
      fn(r);
      return r;
    });
  };
  const submit = (e) => {
    e.preventDefault();
    try {
      const room = normalizeRoom(draft);
      onComplete(room);
    } catch (e) {
      setError(e.message);
    }
  };
  let stats;
  try {
    stats = surfaceAreas(normalizeRoom(draft));
  } catch {}
  return (
    <section className="ss-review">
      <header>
        <span className="ss-kicker">Confirm your measurements</span>
        <h2>Make room for your ideas.</h2>
        <p>
          Check the outline and ceiling height. Add doors and windows so they
          are excluded from paint estimates.
        </p>
      </header>
      <form onSubmit={submit}>
        <label>
          Room name
          <input
            value={draft.name}
            maxLength={100}
            onChange={(e) =>
              change((r) => {
                r.name = e.target.value;
              })
            }
          />
        </label>
        <label>
          Ceiling height (m)
          <input
            type="number"
            step="0.01"
            min="1.8"
            max="8"
            required
            value={draft.ceilingHeight}
            onChange={(e) =>
              change((r) => {
                r.ceilingHeight = Number(e.target.value);
              })
            }
          />
        </label>
        {!initial && (
          <div className="ss-inline">
            <label>
              Room width (m)
              <input
                type="number"
                min="1"
                max="40"
                step="0.01"
                defaultValue={4}
                onChange={(e) =>
                  change((r) => {
                    r.floorPolygon[1].x = r.floorPolygon[2].x = Number(
                      e.target.value,
                    );
                  })
                }
              />
            </label>
            <label>
              Room length (m)
              <input
                type="number"
                min="1"
                max="40"
                step="0.01"
                defaultValue={5}
                onChange={(e) =>
                  change((r) => {
                    r.floorPolygon[2].z = r.floorPolygon[3].z = Number(
                      e.target.value,
                    );
                  })
                }
              />
            </label>
          </div>
        )}
        <details open={!!initial}>
          <summary>Room corners · meters</summary>
          <p className="ss-small">
            Corners follow the perimeter in order. Use this outline for L-shaped
            rooms too.
          </p>
          <div className="ss-corners">
            {draft.floorPolygon.map((p, i) => (
              <div key={i}>
                <strong>{i + 1}</strong>
                <label>
                  X
                  <input
                    aria-label={`Corner ${i + 1} X`}
                    type="number"
                    step="0.01"
                    value={Math.round(p.x * 1000) / 1000}
                    onChange={(e) =>
                      change((r) => {
                        r.floorPolygon[i].x = Number(e.target.value);
                      })
                    }
                  />
                </label>
                <label>
                  Z
                  <input
                    aria-label={`Corner ${i + 1} Z`}
                    type="number"
                    step="0.01"
                    value={Math.round(p.z * 1000) / 1000}
                    onChange={(e) =>
                      change((r) => {
                        r.floorPolygon[i].z = Number(e.target.value);
                      })
                    }
                  />
                </label>
                {draft.floorPolygon.length > 3 && (
                  <button
                    type="button"
                    aria-label={`Remove corner ${i + 1}`}
                    onClick={() =>
                      change((r) => {
                        r.floorPolygon.splice(i, 1);
                        r.walls = [];
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              change((r) => {
                const a = r.floorPolygon[r.floorPolygon.length - 1],
                  b = r.floorPolygon[0];
                r.floorPolygon.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
                r.walls = [];
              })
            }
            disabled={draft.floorPolygon.length >= 32}
          >
            Add corner
          </button>
        </details>
        <details>
          <summary>Doors & windows</summary>
          <p className="ss-small">
            Offset is measured from the start of each wall. Confirm openings
            manually; missing depth alone is not evidence of a window.
          </p>
          {draft.floorPolygon.map((p, i) => {
            const w = draft.walls[i] || { openings: [] };
            return (
              <section className="ss-opening-wall" key={i}>
                <h3>
                  Wall {i + 1} ·{" "}
                  {distance(
                    p,
                    draft.floorPolygon[(i + 1) % draft.floorPolygon.length],
                  ).toFixed(2)}{" "}
                  m
                </h3>
                {w.openings?.map((o, k) => (
                  <div className="ss-opening" key={o.id}>
                    <select
                      aria-label="Opening type"
                      value={o.type}
                      onChange={(e) =>
                        change((r) => {
                          r.walls[i].openings[k].type = e.target.value;
                        })
                      }
                    >
                      <option value="door">Door</option>
                      <option value="window">Window</option>
                    </select>
                    {["offset", "bottom", "width", "height"].map((field) => (
                      <label key={field}>
                        {field} (m)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={o[field]}
                          onChange={(e) =>
                            change((r) => {
                              r.walls[i].openings[k][field] = Number(
                                e.target.value,
                              );
                            })
                          }
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        change((r) => {
                          r.walls[i].openings.splice(k, 1);
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    change((r) => {
                      r.walls[i] ??= { openings: [] };
                      r.walls[i].openings ??= [];
                      r.walls[i].openings.push({
                        id: crypto.randomUUID(),
                        type: "window",
                        offset: 0.3,
                        bottom: 1,
                        width: 0.8,
                        height: 0.8,
                      });
                    })
                  }
                >
                  Add opening
                </button>
              </section>
            );
          })}
        </details>
        {stats && (
          <div className="ss-room-totals">
            <span>
              <strong>{stats.floor.toFixed(1)} m²</strong>floor area
            </span>
            <span>
              <strong>{stats.wallNet.toFixed(1)} m²</strong>paintable walls
            </span>
          </div>
        )}
        <p className="ss-small">
          Phone measurements are estimates. Check critical dimensions with a
          tape measure before buying.
        </p>
        {error && (
          <p role="alert" className="ss-error">
            {error}
          </p>
        )}
        <div className="ss-actions">
          <button type="button" onClick={onCancel}>
            Back
          </button>
          <button className="ss-primary" type="submit">
            Open room editor
          </button>
        </div>
      </form>
    </section>
  );
}
