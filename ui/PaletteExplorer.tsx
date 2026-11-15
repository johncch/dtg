import { useEffect, useMemo, useRef, useState } from "react";
import {
  colorFromOklab, formatAuthored, HEX_SPACE, inGamut, maxChroma, NO_HUE_BELOW_CHROMA,
  oklabToOklch, oklchToOklab, toOklab, type Oklch,
} from "../src/color-math.js";
import type { Edit } from "../src/edit.js";
import { EDITABLE } from "./mode.js";
import { useTrying } from "./preview.js";
import { PalettePlots, type PaletteEntry } from "./PalettePlots.js";

type Props = {
  entries: PaletteEntry[];
  selected: string | null;
  onSelect: (path: string | null) => void;
  onAdd: (channels: Oklch) => void;
  isLocked: (path: string) => boolean;
  guides: number[];
};

export function PaletteExplorer({ entries, selected, onSelect, onAdd, isLocked, guides }: Props) {
  const { preview, previewStep, commitStep } = useTrying();
  const pending = useRef<Edit[] | null>(null);
  /** The colors as a drag found them. `entries` is the preview while one runs, and turning by a preview would compound. */
  const dragStart = useRef<PaletteEntry[] | null>(null);
  const [together, setTogether] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const entry = entries.find((entry) => entry.path === selected);
  const extent = useMemo(() => Math.max(0.3, ...entries.map((entry) => Math.ceil(oklabToOklch(toOklab(entry.color))[1] * 20) / 20)), [entries]);

  const finish = () => {
    dragStart.current = null;
    if (!pending.current) return;
    const edits = pending.current.filter((edit) => !(edit.target.kind === "constant" && isLocked(edit.target.path)));
    pending.current = null;
    if (edits.length === 0) {
      preview(null);
      return;
    }
    commitStep(edits);
  };
  const cancel = () => {
    pending.current = null;
    dragStart.current = null;
    preview(null);
  };
  const written = (target: PaletteEntry, channels: Oklch): Edit => {
    const color = colorFromOklab(oklchToOklab(channels), target.color.alpha);
    return { action: "set", target: { kind: "constant", path: target.path }, value: formatAuthored(toOklab(color), color.alpha) };
  };
  const change = (next: Oklch, path = entry?.path, withOthers = false) => {
    dragStart.current ??= entries;
    const target = dragStart.current.find((entry) => entry.path === path);
    if (!EDITABLE || !target || isLocked(target.path)) return;
    const edits = [written(target, next)];
    const [, startChroma, startHue] = oklabToOklch(toOklab(target.color));
    const turn = next[2] - startHue;
    const scale = next[1] / startChroma;
    if ((together || withOthers) && startChroma >= NO_HUE_BELOW_CHROMA && (turn !== 0 || scale !== 1)) {
      for (const other of dragStart.current) {
        if (other === target || isLocked(other.path)) continue;
        const lab = toOklab(other.color);
        const [L, C, H] = oklabToOklch(lab);
        if (C < NO_HUE_BELOW_CHROMA) continue;
        const hue = ((H + turn) % 360 + 360) % 360;
        // A color hex could hold stays one hex can hold: chroma gives way where there is less room for it.
        edits.push(written(other, [L, inGamut(lab, HEX_SPACE, 1e-4) ? Math.min(C * scale, maxChroma(L, hue, HEX_SPACE)) : C * scale, hue]));
      }
    }
    if (edits.length === 1 && edits[0].action === "set" && edits[0].value === target.written && pending.current == null) return;
    pending.current = edits;
    previewStep(edits);
  };
  const select = (path: string | null) => {
    finish();
    onSelect(path);
  };

  useEffect(() => () => { preview(null); }, []);

  return (
    <section className="palette-explorer" aria-label="Explore palette colors">
      <PalettePlots
        entries={entries}
        active={entry?.path ?? null}
        chromaMax={extent}
        hovered={hovered}
        onHover={setHovered}
        onSelect={select}
        onChange={change}
        onFinish={finish}
        onCancel={cancel}
        onAdd={(channels) => { finish(); onAdd(channels); }}
        isLocked={isLocked}
        guides={guides}
        tools={EDITABLE && (
          <label className="palette-together">
            <input type="checkbox" checked={together} onChange={(event) => setTogether(event.target.checked)} />
            Move together
          </label>
        )}
      />
    </section>
  );
}
