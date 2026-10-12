import { useId, useState } from "react";
import { applyPalette, PALETTES, readPalette, savePalette, type PaletteKey } from "../lib/palette";

// Profile → "Look": pick the app's colours. Changes straight away; saved on this device.
export function LookSection() {
  const heading = useId();
  const [current, setCurrent] = useState<PaletteKey>(() => readPalette());

  function choose(key: PaletteKey) {
    setCurrent(key);
    savePalette(key);
    applyPalette(key);
  }

  return (
    <section className="section" aria-labelledby={heading}>
      <h2 id={heading}>Look</h2>
      <p className="hint">Saved on this device. Dark mode follows your phone's setting.</p>
      <div className="look-options" role="radiogroup" aria-labelledby={heading}>
        {PALETTES.map((p) => (
          <label key={p.key} className="look-option">
            <input
              type="radio"
              name="palette"
              checked={current === p.key}
              onChange={() => choose(p.key)}
            />
            <span className={`look-swatch ${p.key}`} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="look-text">
              <span className="look-name">{p.label}</span>
              <span className="look-note">{p.note}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
