import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { colorFromOklab, formatAuthored, isOpaque, oklabToOklch, oklchToOklab, parseColor, toOklab, type Color, type Oklch } from "../../src/color-math.js";
import type { EditTarget } from "../../src/edit.js";
import type { SnapshotConstant } from "../../src/snapshot.js";
import { ColorTip } from "../ColorTip.js";
import { useProjectGamut } from "../gamut.js";
import { useTrying } from "../preview.js";
import { usePaletteColors } from "../palette-colors.js";
import { useValueInFile } from "../working.js";
import { paintCss } from "../paint.js";
import { Picker } from "./Picker.js";

export function lchOf(color: Color): Oklch {
  const [L, C, H] = oklabToOklch(toOklab(color));
  // A gray has no hue; start the bar at 0 rather than at a rounding error.
  return C < 5e-5 ? [L, 0, 0] : [L, C, H];
}

/** What the editor would write: nothing yet, a color from the picker, or the path of a palette color. */
type Pick = { kind: "untouched" } | { kind: "color"; lch: Oklch } | { kind: "palette"; path: string };

type Mode = "picker" | "palette";

/**
 * The picker as it appears in a popup on an authored color: a bar with the
 * mode and the close control, the color being picked beside the one the
 * definition has, then the picker or the palette. Only a param can name a
 * palette color, so only a param offers the palette.
 */
export function ColorEditor({
  original,
  target,
  named,
  handle,
  close,
}: {
  original: Color;
  target: EditTarget;
  /** The palette color the value names now, when it names one. */
  named: string | null;
  /** Pointer handlers that make the top bar the grip the panel is dragged by. */
  handle: HTMLAttributes<HTMLDivElement>;
  /** The panel's close control, placed at the end of the top bar. */
  close: ReactNode;
}) {
  const gamut = useProjectGamut();
  const palette = usePaletteColors();
  const { preview, commit } = useTrying();
  const canName = target.kind === "param" || target.kind === "default";
  const [mode, setMode] = useState<Mode>(canName && named != null ? "palette" : "picker");
  const [start] = useState(() => lchOf(original));
  const [pick, setPick] = useState<Pick>({ kind: "untouched" });
  const colorAt = (path: string) => palette.find((constant) => constant.path === path)?.color ?? null;

  const valueInFile = useValueInFile(target);
  // With nothing unsaved for this color, the file has what the picker opened on.
  const inFile: Pick =
    valueInFile == null
      ? { kind: "untouched" }
      : colorAt(valueInFile)
        ? { kind: "palette", path: valueInFile }
        : { kind: "color", lch: lchOf(parseColor(valueInFile, "the value in the file")) };
  const colorOf = (candidate: Pick): Color =>
    candidate.kind === "color"
      ? colorFromOklab(oklchToOklab(candidate.lch), original.alpha)
      : candidate.kind === "palette"
        ? (colorAt(candidate.path) ?? original)
        : original;
  // Untouched, "after" is the original itself, not a round trip through OKLCH.
  const picked = colorOf(pick);
  const chosen = pick.kind === "palette" ? pick.path : named;

  // The rest of the app is drawn as if the pick had been written to the
  // definition, in the form it would be written in. Dismissing the picker
  // keeps the pick as an unsaved change; going back to the original first
  // leaves nothing to keep.
  const edit =
    pick.kind === "color"
      ? { action: "set" as const, target, value: formatAuthored(oklchToOklab(pick.lch), original.alpha) }
      : pick.kind === "palette" && pick.path !== named
        ? { action: "set" as const, target, value: pick.path }
        : null;
  const latest = useRef(edit);
  latest.current = edit;
  useEffect(() => preview(edit), [pick]);
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
      setPick({ kind: "untouched" });
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <>
      <div className="editor-bar" {...handle}>
        {canName ? (
          <select aria-label="Mode" value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
            <option value="palette">Palette</option>
            <option value="picker">Picker</option>
          </select>
        ) : (
          <span className="editor-title">Picker</span>
        )}
        {close}
      </div>
      <div className="editor-swatches">
        <ColorTip color={picked}>
          <span className={swatchClass(picked, "editor-current")} aria-label="Selection">
            <span className="swatch-color" style={{ background: paintCss(picked) }} />
          </span>
        </ColorTip>
        <ColorTip color={original}>
          <button type="button" className="editor-reset" aria-label="Go back to the color before" onClick={() => setPick({ kind: "untouched" })}>
            <span className="editor-arrow" aria-hidden>
              ←
            </span>
            <span className={swatchClass(original, "editor-before")}>
              <span className="swatch-color" style={{ background: paintCss(original) }} />
            </span>
          </button>
        </ColorTip>
        <ColorTip color={colorOf(inFile)}>
          <button type="button" className="editor-reset editor-in-file" aria-label="Go back to the color in the file" onClick={() => setPick(inFile)}>
            <span className="editor-file">file</span>
            <span className={swatchClass(colorOf(inFile), "editor-before")}>
              <span className="swatch-color" style={{ background: paintCss(colorOf(inFile)) }} />
            </span>
          </button>
        </ColorTip>
      </div>
      {mode === "picker" ? (
        <Picker value={pick.kind === "color" ? pick.lch : pick.kind === "palette" ? lchOf(picked) : start} gamut={gamut} onChange={(lch) => setPick({ kind: "color", lch })} />
      ) : (
        <PaletteChoices palette={palette} chosen={pick.kind === "color" ? null : chosen} onChoose={(path) => setPick({ kind: "palette", path })} />
      )}
    </>
  );
}

/** The palette colors by group, the ungrouped ones first; choosing one names it. */
function PaletteChoices({
  palette,
  chosen,
  onChoose,
}: {
  palette: SnapshotConstant[];
  chosen: string | null;
  onChoose: (path: string) => void;
}) {
  const groups: { group: string | null; colors: SnapshotConstant[] }[] = [];
  for (const constant of palette) {
    const cut = constant.path.lastIndexOf(".");
    const group = cut === -1 ? null : constant.path.slice(0, cut);
    let holder = groups.find((candidate) => candidate.group === group);
    if (!holder) groups.push((holder = { group, colors: [] }));
    holder.colors.push(constant);
  }
  groups.sort((a, b) => Number(a.group != null) - Number(b.group != null));
  if (groups.length === 0) return <p className="muted">This definition has no palette colors.</p>;
  return (
    <div className="editor-palette">
      {groups.map(({ group, colors }) => (
        <div key={group ?? ""}>
          {group != null && <div className="editor-palette-group">{group}</div>}
          <div className="editor-palette-colors">
            {colors.map((constant) => (
              <ColorTip key={constant.path} color={constant.color}>
                <button
                  type="button"
                  className={constant.path === chosen ? "editor-palette-color editor-palette-chosen" : "editor-palette-color"}
                  aria-pressed={constant.path === chosen}
                  onClick={() => onChoose(constant.path)}
                >
                  <span className={swatchClass(constant.color, "editor-before")}>
                    <span className="swatch-color" style={{ background: paintCss(constant.color) }} />
                  </span>
                  {constant.path.slice(constant.path.lastIndexOf(".") + 1)}
                </button>
              </ColorTip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function swatchClass(color: Color, role: string): string {
  return `swatch ${role}${isOpaque(color) ? "" : " swatch-alpha"}`;
}
