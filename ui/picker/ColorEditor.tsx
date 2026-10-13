import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { colorFromOklab, formatAuthored, isOpaque, oklabToOklch, oklchToOklab, parseColor, toOklab, type Color, type Oklch } from "../../src/color-math.js";
import type { EditTarget } from "../../src/edit.js";
import { ColorTip } from "../ColorTip.js";
import { useProjectGamut } from "../gamut.js";
import { useTrying } from "../preview.js";
import { useValueInFile } from "../working.js";
import { paintCss } from "../paint.js";
import { Picker } from "./Picker.js";

export function lchOf(color: Color): Oklch {
  const [L, C, H] = oklabToOklch(toOklab(color));
  // A gray has no hue; start the bar at 0 rather than at a rounding error.
  return C < 5e-5 ? [L, 0, 0] : [L, C, H];
}

/**
 * The picker as it appears in a popup on an authored color: the color being
 * picked beside the one the definition has, then the field.
 */
export function ColorEditor({
  original,
  target,
  handle,
  close,
}: {
  original: Color;
  target: EditTarget;
  /** Pointer handlers that make the top row the grip the panel is dragged by. */
  handle: HTMLAttributes<HTMLDivElement>;
  /** The panel's close control, placed at the end of the top row. */
  close: ReactNode;
}) {
  const gamut = useProjectGamut();
  const { preview, commit } = useTrying();
  const valueInFile = useValueInFile(target);
  // With nothing unsaved for this color, the file has what the picker opened on.
  const inFile = valueInFile == null ? original : parseColor(valueInFile, "the value in the file");
  const [start] = useState(() => lchOf(original));
  const [lch, setLch] = useState(start);
  const changed = lch !== start;
  // Untouched, "after" is the original itself, not a round trip through OKLCH.
  const picked = changed ? colorFromOklab(oklchToOklab(lch), original.alpha) : original;

  // The rest of the app is drawn as if the pick had been written to the
  // definition, in the form it would be written in. Dismissing the picker
  // keeps the pick as an unsaved change; going back to the original first
  // leaves nothing to keep.
  const edit = changed ? { target, value: formatAuthored(oklchToOklab(lch), original.alpha) } : null;
  const latest = useRef(edit);
  latest.current = edit;
  useEffect(() => preview(edit), [lch]);
  useEffect(
    () => () => {
      if (latest.current) commit(latest.current);
      else preview(null);
    },
    [],
  );

  // With a pick in progress, undo means "not this pick": it is not in the
  // history yet, so there is nothing else for the shortcut to take back first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const undo = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z";
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
      if (!undo || typing || !latest.current) return;
      event.preventDefault();
      setLch(start);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <>
      <div className="editor-head" {...handle}>
        <ColorTip color={picked}>
          <span className={swatchClass(picked, "editor-current")} aria-label="Selection">
            <span className="swatch-color" style={{ background: paintCss(picked) }} />
          </span>
        </ColorTip>
        <ColorTip color={original}>
          <button type="button" className="editor-reset" aria-label="Go back to the color before" onClick={() => setLch(start)}>
            <span className="editor-arrow" aria-hidden>
              ←
            </span>
            <span className={swatchClass(original, "editor-before")}>
              <span className="swatch-color" style={{ background: paintCss(original) }} />
            </span>
          </button>
        </ColorTip>
        <ColorTip color={inFile}>
          <button
            type="button"
            className="editor-reset editor-in-file"
            aria-label="Go back to the color in the file"
            onClick={() => setLch(valueInFile == null ? start : lchOf(inFile))}
          >
            <span className="editor-file">file</span>
            <span className={swatchClass(inFile, "editor-before")}>
              <span className="swatch-color" style={{ background: paintCss(inFile) }} />
            </span>
          </button>
        </ColorTip>
        {close}
      </div>
      <Picker value={lch} gamut={gamut} onChange={setLch} />
    </>
  );
}

function swatchClass(color: Color, role: string): string {
  return `swatch ${role}${isOpaque(color) ? "" : " swatch-alpha"}`;
}
