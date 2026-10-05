import { useEffect, useRef } from "react";
import { create } from "zustand";
import { Check, CircleHalf, Moon, Sun } from "@phosphor-icons/react";

const storageKey = "hardware-store-appearance";
function storedAppearance() {
  try { const saved = localStorage.getItem(storageKey); return ["light", "dark"].includes(saved) ? saved : "system"; }
  catch { return "system"; }
}
export const useStoreAppearance = create((set) => ({
  appearance: storedAppearance(),
  setAppearance: (appearance) => {
    try { localStorage.setItem(storageKey, appearance); } catch { /* Appearance still works without storage. */ }
    set({ appearance });
  },
}));

export default function AppearancePicker() {
  const { appearance, setAppearance } = useStoreAppearance();
  const menu = useRef(null);
  useEffect(() => {
    function dismiss(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && menu.current?.contains(event.target)) return;
      if (menu.current?.open) {
        menu.current.open = false;
        if (event.type === "keydown") menu.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", dismiss); };
  }, []);
  const Icon = appearance === "light" ? Sun : appearance === "dark" ? Moon : CircleHalf;
  return <details className="shop-appearance" ref={menu}>
    <summary className="shop-icon-button" aria-label="Appearance" title="Appearance"><Icon size={22} aria-hidden="true" /></summary>
    <div className="shop-appearance__menu" role="group" aria-label="Appearance options">
      {["system", "light", "dark"].map((value) => <button type="button" key={value} aria-pressed={appearance === value}
        onClick={() => { setAppearance(value); menu.current.open = false; menu.current.querySelector("summary")?.focus(); }}>
        {value === "system" ? "Use system setting" : value === "light" ? "Light" : "Dark"}{appearance === value && <Check size={16} aria-hidden="true" />}
      </button>)}
    </div>
  </details>;
}
