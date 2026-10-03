import { useId, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  Check,
  GridFour,
  PaintRoller,
  Rectangle,
} from "@phosphor-icons/react";
import { defaultFinishSelections, finishSelections, floorFinishes } from "../core/scanCustomization";

const surfaces = [
  { id: "walls", label: "Walls", icon: PaintRoller },
  { id: "floor", label: "Flooring", icon: GridFour },
  { id: "ceiling", label: "Ceiling", icon: Rectangle },
];
const paintColors = [
  { name: "Warm white", color: "#eee8dd" },
  { name: "Sage", color: "#a0afa4" },
  { name: "Mist blue", color: "#b3c0c7" },
  { name: "Clay", color: "#d9b09a" },
  { name: "Sand", color: "#e5d3a4" },
  { name: "Forest", color: "#53665b" },
  { name: "Slate", color: "#424e55" },
  { name: "White", color: "#ffffff" },
];
export default function RoomCustomizationPanel({ customization, availability, onApply, onReset }) {
  const panelId = useId();
  const tabButtons = useRef([]);
  const [surface, setSurface] = useState("walls");
  const [selections, setSelections] = useState(() => finishSelections(customization));
  const [notice, setNotice] = useState("");
  const canApply = !!(availability?.[surface] && onApply);
  const selectedFloor = floorFinishes.find(finish => finish.id === selections.floor.finishId);
  const paint = surface === "floor" ? null : selections[surface];
  const colorName = paintColors.find(choice => choice.color === paint?.color)?.name || "Custom color";

  function updatePaint(values) {
    setNotice("");
    setSelections(previous => ({
      ...previous,
      [surface]: { ...previous[surface], ...values },
    }));
  }
  function updateFloor(values) {
    setNotice("");
    setSelections(previous => ({
      ...previous,
      floor: { ...previous.floor, ...values },
    }));
  }
  function navigateTabs(event, index) {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % surfaces.length;
    else if (event.key === "ArrowLeft") next = (index + surfaces.length - 1) % surfaces.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = surfaces.length - 1;
    else return;
    event.preventDefault();
    setSurface(surfaces[next].id);
    tabButtons.current[next]?.focus();
  }

  return (
    <aside className="ss-customization-panel" aria-labelledby={`${panelId}-heading`}>
      <div className="ss-customization-heading">
        <div>
          <h2 id={`${panelId}-heading`}>Customize your room</h2>
          <p>Explore a new palette and finish.</p>
        </div>
        <button
          type="button"
          className="ss-customization-reset"
          aria-label="Reset finish selections"
          title="Reset finish selections"
          onClick={() => {
            setSelections(defaultFinishSelections());
            onReset?.();
            setNotice("Captured finishes restored.");
          }}
        >
          <ArrowCounterClockwise size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="ss-customization-tabs" role="tablist" aria-label="Room surfaces">
        {surfaces.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            ref={element => { tabButtons.current[index] = element; }}
            id={`${panelId}-${id}-tab`}
            type="button"
            role="tab"
            aria-selected={surface === id}
            aria-controls={`${panelId}-${id}-panel`}
            tabIndex={surface === id ? 0 : -1}
            onClick={() => setSurface(id)}
            onKeyDown={event => navigateTabs(event, index)}
          >
            <Icon size={19} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div
        className="ss-customization-content"
        id={`${panelId}-${surface}-panel`}
        role="tabpanel"
        aria-labelledby={`${panelId}-${surface}-tab`}
        tabIndex={0}
      >
        <div className="ss-customization-section-heading">
          <h3>{surface === "floor" ? "Floor finishes" : surface === "walls" ? "Wall paint" : "Ceiling paint"}</h3>
          <p>Sample finishes</p>
        </div>
        {surface === "floor" ? (
          <>
            <div className="ss-floor-finishes" role="group" aria-label="Sample flooring finishes">
              {floorFinishes.map(finish => (
                <button
                  key={finish.id}
                  type="button"
                  aria-pressed={selectedFloor.id === finish.id}
                  onClick={() => updateFloor({ finishId: finish.id })}
                >
                  <span
                    className={`ss-finish-sample ss-finish-sample--${finish.pattern}`}
                    style={{ "--finish-color": finish.color }}
                    aria-hidden="true"
                  />
                  <span className="ss-floor-finish-name">
                    <strong>{finish.name}</strong>
                    <small>{finish.kind}</small>
                  </span>
                  {selectedFloor.id === finish.id && <Check className="ss-finish-check" size={16} weight="bold" aria-hidden="true" />}
                </button>
              ))}
            </div>
            <label className="ss-customization-field">
              Pattern direction
              <select
                value={selections.floor.direction}
                onChange={event => updateFloor({ direction: event.target.value })}
              >
                <option value="lengthwise">Lengthwise</option>
                <option value="crosswise">Crosswise</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <div className="ss-paint-swatches" role="group" aria-label={`${surface === "walls" ? "Wall" : "Ceiling"} paint colors`}>
              {paintColors.map(choice => (
                <button
                  key={choice.color}
                  type="button"
                  aria-label={choice.name}
                  title={choice.name}
                  aria-pressed={paint.color === choice.color}
                  style={{ backgroundColor: choice.color }}
                  onClick={() => updatePaint({ color: choice.color })}
                >
                  {paint.color === choice.color && <Check size={20} weight="bold" aria-hidden="true" />}
                </button>
              ))}
            </div>
            <label className="ss-customization-field">
              Custom color
              <span className="ss-custom-color">
                <input
                  type="color"
                  value={paint.color}
                  onChange={event => updatePaint({ color: event.target.value })}
                />
                <span>{paint.color.toUpperCase()}</span>
              </span>
            </label>
            <label className="ss-customization-field">
              Paint finish
              <select value={paint.finish} onChange={event => updatePaint({ finish: event.target.value })}>
                <option>Matte</option>
                <option>Eggshell</option>
                <option>Satin</option>
              </select>
            </label>
          </>
        )}
        <div className="ss-customization-preview" aria-label="Selected finish preview" aria-live="polite">
          <span
            className={surface === "floor"
              ? `ss-finish-sample ss-finish-sample--${selectedFloor.pattern}`
              : "ss-finish-sample"}
            style={{
              "--finish-color": paint?.color || selectedFloor.color,
              "--finish-direction": selections.floor.direction === "crosswise" ? "90deg" : "0deg",
            }}
            aria-hidden="true"
          />
          <div>
            <span>Selected finish</span>
            <strong>{surface === "floor" ? selectedFloor.name : colorName}</strong>
            <small>{surface === "floor"
              ? `${selectedFloor.kind} · ${selections.floor.direction === "lengthwise" ? "Lengthwise" : "Crosswise"}`
              : `${paint.finish} · ${paint.color.toUpperCase()}`}</small>
          </div>
        </div>
      </div>

      <div className="ss-customization-footer">
        <button type="button" className={canApply ? "ss-primary" : ""} disabled={!canApply}
          aria-describedby={`${panelId}-availability`}
          onClick={() => {
            onApply(surface, selections[surface]);
            setNotice(`${surface === "walls" ? "Wall paint" : surface === "floor" ? "Flooring" : "Ceiling paint"} applied to your room.`);
          }}>
          <PaintRoller size={18} aria-hidden="true" />
          Apply to room
        </button>
        <p id={`${panelId}-availability`} role="status">
          {canApply ? notice || "Choose a finish, then apply it to this surface."
            : `No editable ${surface === "walls" ? "wall" : surface} surface was detected in this scan.`}
          {" "}Export the scan to save your design.
        </p>
      </div>
    </aside>
  );
}
