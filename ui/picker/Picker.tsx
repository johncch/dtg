import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  formatIn,
  maxChroma,
  oklabToLinear,
  oklabToOklch,
  oklchToOklab,
  parseColor,
  toOklab,
  type Gamut,
  type Oklch,
} from "../../src/color-math.js";
import { isExactIn, NOTATIONS, type Box, type Notation, type NotationId } from "./notations.js";

const FIELD_WIDTH = 360;
const FIELD_HEIGHT = 240;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** In steps, the field is a grid of flat cells: chroma share from 0 to 1 across, lightness from 1 to 0 down. */
const COLUMNS = 15;
const ROWS = 15;
const SHARE_STEPS = COLUMNS - 1;
const LIGHTNESS_STEPS = ROWS - 1;
/** How much of a cell's color its seam keeps, out of 255: enough to read as the cell's edge, not a gap. */
const SEAM_ALPHA = 150;

const cellOf = (fraction: number, cells: number) => Math.min(cells - 1, Math.floor(fraction * cells));

/** Whether a pixel is the last one of its cell, short of the field's own edge. */
const lastInCell = (pixel: number, size: number, cells: number) =>
  pixel < size - 1 && cellOf(pixel / size, cells) !== cellOf((pixel + 1) / size, cells);

/** How far across the field a color sits: its chroma as a share of the most the gamut shows at that lightness and hue. */
function chromaShare([L, C, H]: Oklch, gamut: Gamut): number {
  const most = maxChroma(clamp01(L), H, gamut);
  return most > 1e-6 ? clamp01(C / most) : 0;
}

/**
 * Every hue at the most vivid color the gamut has for it, so the bar reads
 * as a map of hues whatever is currently picked. The vivid point sits at a
 * different lightness for each hue — high for yellow, low for blue — so it is
 * searched for rather than taken at one lightness.
 */
function vividHueGradient(gamut: Gamut, paintGamut: Gamut): string {
  const stops: string[] = [];
  for (let hue = 0; hue <= 360; hue += 5) {
    let vivid: Oklch = [0.5, 0, hue];
    for (let lightness = 0.3; lightness <= 0.98; lightness += 0.02) {
      const chroma = maxChroma(lightness, hue, gamut);
      if (chroma > vivid[1]) vivid = [lightness, chroma, hue];
    }
    stops.push(`${formatIn(oklchToOklab(vivid), paintGamut)} ${(hue / 360) * 100}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * The stretched OKLCH picker: lightness up, share of displayable chroma
 * across, hue on the bar. Every point in the field is a color the chosen
 * gamut can show, and scrubbing hue holds lightness and the share.
 */
export function Picker({
  value,
  gamut,
  axes = false,
  onChange,
}: {
  value: Oklch;
  gamut: Gamut;
  /** Captions naming what the field's two directions mean. */
  axes?: boolean;
  onChange: (next: Oklch) => void;
}) {
  const [L, C, H] = value;
  const share = chromaShare(value, gamut);
  const [stepped, setStepped] = useState(false);
  const { canvasRef, paintGamut } = useField(H, gamut, stepped);

  const hueGradient = useMemo(() => vividHueGradient(gamut, paintGamut), [gamut, paintGamut]);

  const pick = (lightness: number, chromaShareOf: number) =>
    onChange([lightness, chromaShareOf * maxChroma(lightness, H, gamut), H]);
  const field = useDrag((across, down) => {
    if (stepped) pick(1 - cellOf(down, ROWS) / LIGHTNESS_STEPS, cellOf(across, COLUMNS) / SHARE_STEPS);
    else pick(1 - down, across);
  });
  // A color picked before steps were on sits between cells; the dot shows the nearest one.
  const column = Math.round(share * SHARE_STEPS);
  const row = Math.round((1 - clamp01(L)) * LIGHTNESS_STEPS);
  const dot = stepped
    ? { left: `${((column + 0.5) / COLUMNS) * 100}%`, top: `${((row + 0.5) / ROWS) * 100}%` }
    : { left: `${share * 100}%`, top: `${(1 - clamp01(L)) * 100}%` };
  const stepWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!stepped || !move) return;
    event.preventDefault();
    const nextColumn = Math.min(SHARE_STEPS, Math.max(0, column + move[0]));
    const nextRow = Math.min(LIGHTNESS_STEPS, Math.max(0, row + move[1]));
    pick(1 - nextRow / LIGHTNESS_STEPS, nextColumn / SHARE_STEPS);
  };
  const hueBar = useDrag((across) => {
    const hue = Math.min(359.999, across * 360);
    onChange([L, share * maxChroma(clamp01(L), hue, gamut), hue]);
  });

  return (
    <>
      <div className="field-wrap" tabIndex={stepped ? 0 : undefined} onKeyDown={stepWithKeys} {...field}>
        <canvas ref={canvasRef} width={FIELD_WIDTH} height={FIELD_HEIGHT} />
        <span className="dot" style={dot} />
      </div>
      {axes && (
        <div className="axes">
          <span>chroma 0 to the display's most →</span>
          <span>lightness 0 to 1 ↑</span>
        </div>
      )}
      <div className="hue" style={{ background: hueGradient }} {...hueBar}>
        <span className="dot" style={{ left: `${(H / 360) * 100}%` }} />
      </div>
      <label className="picker-steps">
        <input type="checkbox" checked={stepped} onChange={(event) => setStepped(event.target.checked)} />
        steps
      </label>
      {paintGamut === "srgb" && (
        <p className="cap">
          This browser did not give a Display P3 canvas, so colors past the sRGB line look the same as those on it.
        </p>
      )}
      <Values value={value} onChange={onChange} />
    </>
  );
}

function useField(hue: number, gamut: Gamut, stepped: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paintGamut, setPaintGamut] = useState<Gamut>("display-p3");

  useEffect(() => {
    const canvas = canvasRef.current!;
    // The first getContext call fixes the canvas's color space for good, so
    // ask for P3 and read back what the browser actually granted.
    const context = canvas.getContext("2d", { colorSpace: "display-p3" })!;
    const granted: Gamut = context.getContextAttributes().colorSpace === "display-p3" ? "display-p3" : "srgb";
    setPaintGamut(granted);

    const frame = requestAnimationFrame(() => {
      const image = context.createImageData(FIELD_WIDTH, FIELD_HEIGHT);
      let previousLine: number | null = null;
      // Which cells sRGB can show, for the boundary drawn along their seams.
      // Near black the two gamuts' limits are a rounding error apart, so those cells count as sRGB.
      const cellInSrgb = Array.from({ length: ROWS }, (_, row) => {
        const lightness = 1 - row / LIGHTNESS_STEPS;
        const most = maxChroma(lightness, hue, gamut);
        const srgbMost = maxChroma(lightness, hue, "srgb");
        return Array.from({ length: COLUMNS }, (_, column) => most <= 0.005 || (column / SHARE_STEPS) * most <= srgbMost + 1e-6);
      });
      for (let py = 0; py < FIELD_HEIGHT; py++) {
        const lightness = stepped
          ? 1 - cellOf(py / FIELD_HEIGHT, ROWS) / LIGHTNESS_STEPS
          : 1 - py / (FIELD_HEIGHT - 1);
        const most = maxChroma(lightness, hue, gamut);
        for (let px = 0; px < FIELD_WIDTH; px++) {
          const shareAt = stepped ? cellOf(px / FIELD_WIDTH, COLUMNS) / SHARE_STEPS : px / (FIELD_WIDTH - 1);
          const linear = oklabToLinear(oklchToOklab([lightness, most * shareAt, hue]), granted);
          const offset = (py * FIELD_WIDTH + px) * 4;
          for (let channel = 0; channel < 3; channel++) {
            const c = clamp01(linear[channel]);
            image.data[offset + channel] = Math.round(
              255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055),
            );
          }
          image.data[offset + 3] = 255;
          if (!stepped) continue;
          // A cell's last row and column are its seam: faded, or the sRGB line where the seam crosses it.
          const acrossSeam = lastInCell(px, FIELD_WIDTH, COLUMNS);
          const downSeam = lastInCell(py, FIELD_HEIGHT, ROWS);
          if (!acrossSeam && !downSeam) continue;
          const row = cellOf(py / FIELD_HEIGHT, ROWS);
          const column = cellOf(px / FIELD_WIDTH, COLUMNS);
          const inSrgb = cellInSrgb[row][column];
          const onSrgbLine =
            gamut === "display-p3" &&
            ((acrossSeam && inSrgb !== cellInSrgb[row][column + 1]) || (downSeam && inSrgb !== cellInSrgb[row + 1][column]));
          if (onSrgbLine) image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 255;
          else image.data[offset + 3] = SEAM_ALPHA;
        }
        // Near black the two gamuts' limits are both a rounding error apart, and the line is noise.
        if (gamut === "display-p3" && most > 0.005 && !stepped) {
          const line = Math.round((maxChroma(lightness, hue, "srgb") / most) * (FIELD_WIDTH - 1));
          const from = previousLine == null ? line : Math.min(line, previousLine);
          const to = previousLine == null ? line : Math.max(line, previousLine);
          for (let px = from; px <= to && px < FIELD_WIDTH - 1; px++) {
            const offset = (py * FIELD_WIDTH + px) * 4;
            image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 255;
          }
          previousLine = line;
        }
      }
      context.putImageData(image, 0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [hue, gamut, stepped]);

  return { canvasRef, paintGamut };
}

/** Pointer handlers reporting the position inside the element as fractions, while the button is held. */
function useDrag(onMove: (across: number, down: number) => void) {
  const dragging = useRef(false);
  const report = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onMove(clamp01((event.clientX - box.left) / box.width), clamp01((event.clientY - box.top) / box.height));
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      report(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (dragging.current) report(event);
    },
    onPointerUp: () => {
      dragging.current = false;
    },
    onPointerCancel: () => {
      dragging.current = false;
    },
  };
}

const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

type ValueFormat = NotationId | "hex";
const FORMAT_SAVED = "dtg.picker.format";

function savedFormat(): ValueFormat {
  const saved = localStorage.getItem(FORMAT_SAVED);
  return saved === "hex" || (saved != null && saved in NOTATIONS) ? (saved as ValueFormat) : "oklch";
}

const SRGB_ONLY = "The selected color is outside sRGB. The value shown is the nearest sRGB color.";
const P3_ONLY = "The selected color is outside Display P3. The value shown is the nearest P3 color.";

/** A gray read back from an RGB-based notation has lost its hue; keep the bar where it was. */
function keepingHue(next: Oklch, current: Oklch): Oklch {
  return next[1] < 5e-5 ? [next[0], 0, current[2]] : next;
}

/** The color as numbers: a notation to read it in, then that notation's boxes. */
function Values({ value, onChange }: { value: Oklch; onChange: (next: Oklch) => void }) {
  const [format, setFormat] = useState(savedFormat);
  const gamut = format === "hex" ? "srgb" : NOTATIONS[format].gamut;
  const approximate = isExactIn(value, gamut) ? undefined : gamut === "srgb" ? SRGB_ONLY : P3_ONLY;

  return (
    <div>
      <div className="values">
        <select
          aria-label="Notation"
          value={format}
          onChange={(event) => {
            const next = event.target.value as ValueFormat;
            localStorage.setItem(FORMAT_SAVED, next);
            setFormat(next);
          }}
        >
          <option value="oklch">OKLCH</option>
          <option value="hex">Hex</option>
          <option value="rgb">RGB</option>
          <option value="hsl">HSL</option>
          <option value="hsb">HSB</option>
          <option value="p3">Display P3</option>
        </select>
        {format === "hex" ? (
          <HexField value={value} note={approximate} onChange={onChange} />
        ) : (
          <NotationBoxes key={format} notation={NOTATIONS[format]} value={value} note={approximate} onChange={onChange} />
        )}
      </div>
      <p className="values-note">{approximate}</p>
    </div>
  );
}

function NotationBoxes({
  notation,
  value,
  note,
  onChange,
}: {
  notation: Notation;
  value: Oklch;
  note: string | undefined;
  onChange: (next: Oklch) => void;
}) {
  // What was typed is kept for as long as the color is still the one it
  // produced. HSL and HSB cannot say what hue a gray has, so reading the gray
  // back would forget the hue just typed; the typed numbers do not.
  const [held, setHeld] = useState<{ numbers: number[]; produced: Oklch } | null>(null);
  const numbers = held && held.produced === value ? held.numbers : notation.read(value);
  return notation.boxes.map((box, index) => (
    <NumberField
      key={box.name}
      box={box}
      note={note}
      value={numbers[index]}
      onChange={(typed) => {
        const next = [...numbers];
        next[index] = Math.min(box.max, Math.max(box.min, typed));
        const produced = notation.gamut == null ? notation.write(next) : keepingHue(notation.write(next), value);
        setHeld({ numbers: next, produced });
        onChange(produced);
      }}
    />
  ));
}

function NumberField({
  box,
  value,
  note,
  onChange,
}: {
  box: Box;
  value: number;
  note: string | undefined;
  onChange: (next: number) => void;
}) {
  // Shows what was typed for as long as the value still reads as the number
  // that typing produced, so a half-entered number is not rewritten under the
  // cursor but a change from anywhere else replaces it. Compared as shown,
  // because a value that went through another notation comes back a rounding
  // error away from what was typed.
  const [draft, setDraft] = useState<{ text: string; standsFor: number } | null>(null);
  const shown = trim(value, box.digits);
  return (
    <input
      type="number"
      aria-label={box.name}
      title={note ? `${box.name} — ${note}` : box.name}
      min={box.min}
      max={box.max}
      step={box.step}
      value={draft && trim(draft.standsFor, box.digits) === shown ? draft.text : shown}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        const text = event.target.value;
        const next = Number(text);
        const usable = text !== "" && Number.isFinite(next);
        setDraft({ text, standsFor: usable ? next : value });
        if (usable) onChange(next);
      }}
    />
  );
}

/** The sRGB hex: exact for a color sRGB holds, the nearest one otherwise. */
function HexField({
  value,
  note,
  onChange,
}: {
  value: Oklch;
  note: string | undefined;
  onChange: (next: Oklch) => void;
}) {
  const hex = formatIn(oklchToOklab(value), "srgb");
  const [draft, setDraft] = useState<{ text: string; standsFor: string } | null>(null);
  return (
    <input
      type="text"
      aria-label="Hex"
      title={note ? `Hex — ${note}` : "Hex"}
      spellCheck={false}
      autoComplete="off"
      value={draft && draft.standsFor === hex ? draft.text : hex}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        const text = event.target.value;
        try {
          const typed = oklabToOklch(toOklab(parseColor(text.startsWith("#") ? text : `#${text}`, "hex")));
          const next = keepingHue(typed, value);
          setDraft({ text, standsFor: formatIn(oklchToOklab(next), "srgb") });
          onChange(next);
        } catch {
          setDraft({ text, standsFor: hex });
        }
      }}
    />
  );
}
