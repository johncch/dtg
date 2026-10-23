import { useEffect, useRef, useState } from "react";
import {
  formatAuthored,
  isOpaque,
  NO_HUE_BELOW_CHROMA,
  oklabToOklch,
  oklchToOklab,
  parseColor,
  toOklab,
  type Color,
  type Oklch,
} from "../../src/color-math.js";
import type { EditTarget } from "../../src/edit.js";
import { formatRef, INHERIT } from "../../src/selector.js";
import type { SnapshotConstant, SnapshotSystem } from "../../src/snapshot.js";
import { ColorFacts, ColorTip } from "../ColorTip.js";
import { useProjectGamut } from "../gamut.js";
import { paintCss } from "../paint.js";
import type { PopupPanel } from "../Popup.js";
import { useTrying } from "../preview.js";
import { useValueInFile } from "../working.js";
import { Picker } from "./Picker.js";
import {
  carriedOver,
  pointingOf,
  refOf,
  StepControls,
} from "./StepControls.js";

/** Where a value can be chosen from. Each surface offers the ones its grammar allows, first one default. */
export type Source = "picker" | "palette" | "systems" | "roles";

/** What the value being tried comes to: a color, or the reason it cannot be drawn. */
export type Drawn =
  { kind: "color"; color: Color } | { kind: "refused"; error: string };

export type Choice = { path: string; color: Color };

export function lchOf(color: Color): Oklch {
  const [L, C, H] = oklabToOklch(toOklab(color));
  // A gray has no hue; start the bar at 0 rather than at a rounding error.
  return C < NO_HUE_BELOW_CHROMA ? [L, 0, 0] : [L, C, H];
}

const SOURCE_LABEL: Record<Source, string> = {
  picker: "Picker",
  palette: "Palette",
  systems: "Systems",
  roles: "Roles",
};
const INHERITED = "inherit";

/**
 * The one editor for a written value, wherever one is edited: a palette
 * entry, a system param, a role's ref for one mode, a mode's editor
 * background. The value is the string as it would be written. The surface
 * says which sources it offers; the editor shows the chosen source's
 * controls, the value as text so anything can be typed, and the color it
 * comes to beside the one it opened on. The value is previewed while the
 * editor is open and committed when it is dismissed.
 */
export function ValueEditor({
  value,
  drawn,
  sources,
  constants,
  systems = [],
  roles = [],
  transparent = false,
  inherits = null,
  valueInFile = null,
  panel,
  onPreview,
  onCommit,
}: {
  /** As written when the editor opens; `INHERIT` on a role that says nothing for its mode. */
  value: string;
  /** What the value being tried comes to, as the app draws it now. */
  drawn: Drawn;
  sources: Source[];
  constants: SnapshotConstant[];
  systems?: SnapshotSystem[];
  /** The roles that can be pointed at, colored for the mode being edited. */
  roles?: Choice[];
  /** The palette offers `transparent(name pct)`: only where the value is a ref. */
  transparent?: boolean;
  /** The mode this one extends and the ref it would take from it, on a role in such a mode. */
  inherits?: { mode: string; ref: string } | null;
  /** What the file has, when that differs from the value as it opened. */
  valueInFile?: string | null;
  panel: PopupPanel;
  /** Called with the value being tried, or null when it is back to the one it opened on. */
  onPreview: (value: string | null) => void;
  onCommit: (value: string) => void;
}) {
  const gamut = useProjectGamut();
  // The surface redraws with the value being tried, so what it opened on is taken once.
  const [original] = useState(value);
  const [originalColor] = useState(() =>
    drawn.kind === "color" ? drawn.color : parseColor("#000000", "editor"),
  );
  const [text, setText] = useState(original);
  const trimmed = text.trim();
  // The text is state so a value can arrive from any control; nothing types it directly.
  const [source, setSource] = useState<Source>(
    () => sourceOf(original, sources, constants, systems, roles) ?? sources[0],
  );
  const [lch, setLch] = useState(() => lchOf(originalColor));
  const lastGood = useRef(originalColor);
  if (drawn.kind === "color") lastGood.current = drawn.color;
  const current = lastGood.current;
  const alpha = originalColor.alpha;

  const tried = trimmed !== original && trimmed !== "" ? trimmed : null;
  const latest = useRef({ tried, onCommit, onPreview });
  latest.current = { tried, onCommit, onPreview };
  useEffect(() => onPreview(tried), [tried]);
  useEffect(
    () => () => {
      if (latest.current.tried != null && !panel.escaped())
        latest.current.onCommit(latest.current.tried);
      else latest.current.onPreview(null);
    },
    [],
  );

  // With a pick in progress, undo means "not this pick": it is not in the
  // history yet, so there is nothing else for the shortcut to take back first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const undo =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z";
      const typing =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement;
      if (!undo || typing || latest.current.tried == null) return;
      event.preventDefault();
      setText(original);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  const take = (next: string) => {
    setText(next);
    const literal = colorOrNull(next);
    if (literal) setLch(lchOf(literal));
  };
  // A list is a menu: choosing closes. The panel may unmount before the next
  // render, so what the unmount commits is set here rather than left to it.
  const choose = (next: string) => {
    take(next);
    latest.current = {
      ...latest.current,
      tried: next !== original ? next : null,
    };
    panel.dismiss();
  };

  const inheriting = trimmed === INHERIT;
  // Leaving inheritance starts from the ref that was inherited, not from nothing.
  const basis = inheriting && inherits ? inherits.ref : trimmed;
  const pointing = pointingOf(basis, systems, constants);
  const chosenConstant = pointing?.kind === "constant" ? pointing : null;
  const chosenRole = roles.find((role) => role.path === basis) ?? null;
  // The Systems controls show the first system until one is chosen or a control is touched; looking writes nothing.
  const [draftSystem, setDraftSystem] = useState(() => systems[0] ?? null);
  const step =
    pointing?.kind === "step"
      ? pointing
      : draftSystem
        ? {
            kind: "step" as const,
            system: draftSystem,
            selector: carriedOver(pointing, draftSystem.selector),
          }
        : null;
  const fileColor =
    valueInFile == null ? null : colorOf(valueInFile, constants, roles);

  return (
    <form
      className="value-editor"
      onSubmit={(event) => {
        event.preventDefault();
        panel.dismiss();
      }}
    >
      <div className="editor-bar" {...panel.handle}>
        <span className="editor-source">
          {sources.length === 1 && !inherits ? (
            <span className="editor-title">{SOURCE_LABEL[sources[0]]}</span>
          ) : (
            <select
              aria-label="From"
              value={inheriting ? INHERITED : source}
              onChange={(event) => {
                if (event.target.value === INHERITED) {
                  setText(INHERIT);
                  return;
                }
                const next = event.target.value as Source;
                if (next === "picker") setLch(lchOf(current));
                setSource(next);
                if (inheriting && next !== "systems")
                  setText(inherits?.ref ?? "");
              }}
            >
              {inherits && (
                <option value={INHERITED}>inherit from {inherits.mode}</option>
              )}
              {sources.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {SOURCE_LABEL[candidate]}
                </option>
              ))}
            </select>
          )}
        </span>
        {panel.close}
      </div>

      <div className="editor-body">
        {source === "picker" && (
          <>
            <div className="editor-swatches">
              <ColorTip color={current}>
                <span
                  className={swatchClass(
                    current,
                    drawn.kind === "refused"
                      ? "editor-current editor-stale"
                      : "editor-current",
                  )}
                  aria-label="Selection"
                >
                  <span
                    className="swatch-color"
                    style={{ background: paintCss(current) }}
                  />
                </span>
              </ColorTip>
              <ColorTip color={originalColor}>
                <button
                  type="button"
                  className="editor-reset"
                  aria-label="Go back to the value before"
                  onClick={() => take(original)}
                >
                  <span className="editor-arrow" aria-hidden>
                    ←
                  </span>
                  <span className={swatchClass(originalColor, "editor-before")}>
                    <span
                      className="swatch-color"
                      style={{ background: paintCss(originalColor) }}
                    />
                  </span>
                </button>
              </ColorTip>
              {valueInFile != null && (
                <button
                  type="button"
                  className="editor-reset editor-in-file"
                  aria-label="Go back to the value in the file"
                  onClick={() => take(valueInFile)}
                >
                  <span className="editor-file">file</span>
                  {fileColor ? (
                    <ColorTip color={fileColor}>
                      <span className={swatchClass(fileColor, "editor-before")}>
                        <span
                          className="swatch-color"
                          style={{ background: paintCss(fileColor) }}
                        />
                      </span>
                    </ColorTip>
                  ) : (
                    <code>{valueInFile}</code>
                  )}
                </button>
              )}
            </div>
            <Picker
              value={lch}
              gamut={gamut}
              onChange={(next) => {
                setLch(next);
                setText(formatAuthored(oklchToOklab(next), alpha));
              }}
            />
          </>
        )}
        {source === "palette" && (
          <>
            <ChoiceGrid
              choices={constants}
              chosen={chosenConstant?.path ?? null}
              onChoose={(path) =>
                choose(
                  chosenConstant?.opacity == null
                    ? path
                    : transparentRef(path, chosenConstant.opacity),
                )
              }
            />
            {transparent && (
              <div className="ref-controls">
                <label className="ref-control ref-control-check">
                  <span>transparent</span>
                  <input
                    type="checkbox"
                    disabled={chosenConstant == null}
                    checked={chosenConstant?.opacity != null}
                    onChange={(event) =>
                      chosenConstant &&
                      take(
                        event.target.checked
                          ? transparentRef(chosenConstant.path, 50)
                          : chosenConstant.path,
                      )
                    }
                  />
                </label>
                {chosenConstant?.opacity != null && (
                  <label className="ref-control">
                    <span>opacity</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={0.5}
                      value={chosenConstant.opacity}
                      onChange={(event) =>
                        take(
                          transparentRef(
                            chosenConstant.path,
                            Number(event.target.value),
                          ),
                        )
                      }
                    />
                    <input
                      className="ref-number"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={chosenConstant.opacity}
                      onChange={(event) => {
                        const opacity = Number(event.target.value);
                        if (opacity >= 0 && opacity <= 100)
                          take(transparentRef(chosenConstant.path, opacity));
                      }}
                    />
                  </label>
                )}
              </div>
            )}
          </>
        )}
        {source === "roles" && (
          <ChoiceGrid
            choices={roles}
            chosen={chosenRole?.path ?? null}
            onChoose={choose}
          />
        )}
        {source === "systems" && (
          <div className="ref-controls">
            <label className="ref-control">
              <span>system</span>
              <select
                value={step?.system.system ?? ""}
                onChange={(event) => {
                  const system = systems.find(
                    (candidate) => candidate.system === event.target.value,
                  );
                  if (!system) return;
                  setDraftSystem(system);
                  take(
                    refOf({
                      kind: "step",
                      system,
                      selector: carriedOver(pointing, system.selector),
                    }),
                  );
                }}
              >
                {systems.map((system) => (
                  <option key={system.system} value={system.system}>
                    {system.system}
                  </option>
                ))}
              </select>
            </label>
            {step && (
              <StepControls
                step={step}
                onChange={(next) => take(refOf(next))}
              />
            )}
          </div>
        )}

        {source === "systems" && (
          <div
            className={
              drawn.kind === "refused"
                ? "editor-facts editor-stale"
                : "editor-facts"
            }
          >
            <ColorFacts color={current} />
          </div>
        )}
      </div>
      {tried != null && drawn.kind === "refused" && (
        <p className="ref-error">{firstError(drawn.error)}</p>
      )}
    </form>
  );
}

/** The editor on a value written in the definition: tried through the app's preview, committed as an unsaved change. */
export function TargetValueEditor({
  target,
  color,
  ...editor
}: {
  target: EditTarget;
  /** What the value comes to as drawn now, which follows the value being tried. */
  color: Color;
} & Omit<
  Parameters<typeof ValueEditor>[0],
  "drawn" | "valueInFile" | "onPreview" | "onCommit"
>) {
  const { preview, commit, refusal } = useTrying();
  const valueInFile = useValueInFile(target);
  const drawn: Drawn = refusal
    ? { kind: "refused", error: refusal }
    : { kind: "color", color };
  return (
    <ValueEditor
      {...editor}
      drawn={drawn}
      valueInFile={valueInFile}
      onPreview={(value) =>
        preview(value == null ? null : { action: "set", target, value })
      }
      onCommit={(value) => commit({ action: "set", target, value })}
    />
  );
}

/** The sources a value can be edited from, by what is written at a target. */
export function sourcesFor(target: EditTarget): Source[] {
  if (target.kind === "ref") return ["palette", "systems", "roles"];
  if (target.kind === "constant") return ["picker"];
  return ["picker", "palette"];
}

/** Which source the written value came from, or null when it does not read as any. */
function sourceOf(
  written: string,
  sources: Source[],
  constants: SnapshotConstant[],
  systems: SnapshotSystem[],
  roles: Choice[],
): Source | null {
  const has = (source: Source) => sources.includes(source);
  if (has("picker") && colorOrNull(written)) return "picker";
  if (has("roles") && roles.some((role) => role.path === written))
    return "roles";
  const pointing = pointingOf(written, systems, constants);
  if (has("palette") && pointing?.kind === "constant") return "palette";
  if (has("systems") && pointing?.kind === "step") return "systems";
  return null;
}

function colorOrNull(written: string): Color | null {
  try {
    return parseColor(written, "editor");
  } catch {
    return null;
  }
}

/** The color a value comes to when the editor can tell on its own: a color, a palette color, or a role. */
function colorOf(
  written: string,
  constants: SnapshotConstant[],
  roles: Choice[],
): Color | null {
  return (
    colorOrNull(written) ??
    constants.find((constant) => constant.path === written)?.color ??
    roles.find((role) => role.path === written)?.color ??
    null
  );
}

function transparentRef(path: string, opacity: number): string {
  return formatRef("transparent", `${path} ${opacity}`);
}

/** The first of a refusal's errors: the reason, before everything that fails because of it. */
function firstError(refusal: string): string {
  const first = refusal.split("\n").find((line) => line.startsWith("- "));
  return first ? first.slice(2) : refusal;
}

/** Named colors by group, the ungrouped ones first; choosing one names it. */
function ChoiceGrid({
  choices,
  chosen,
  onChoose,
}: {
  choices: Choice[];
  chosen: string | null;
  onChoose: (path: string) => void;
}) {
  const groups: { group: string | null; colors: Choice[] }[] = [];
  for (const choice of choices) {
    const cut = choice.path.lastIndexOf(".");
    const group = cut === -1 ? null : choice.path.slice(0, cut);
    let holder = groups.find((candidate) => candidate.group === group);
    if (!holder) groups.push((holder = { group, colors: [] }));
    holder.colors.push(choice);
  }
  groups.sort((a, b) => Number(a.group != null) - Number(b.group != null));
  if (groups.length === 0)
    return <p className="muted">This definition has none.</p>;
  return (
    <div className="editor-palette">
      {groups.map(({ group, colors }) => (
        <div key={group ?? ""}>
          {group != null && <div className="editor-palette-group">{group}</div>}
          <div className="editor-palette-colors">
            {colors.map((choice) => (
              <ColorTip key={choice.path} color={choice.color} side="right">
                <button
                  type="button"
                  className={
                    choice.path === chosen
                      ? "editor-palette-color editor-palette-chosen"
                      : "editor-palette-color"
                  }
                  aria-pressed={choice.path === chosen}
                  onClick={() => onChoose(choice.path)}
                >
                  <span className={swatchClass(choice.color, "editor-before")}>
                    <span
                      className="swatch-color"
                      style={{ background: paintCss(choice.color) }}
                    />
                  </span>
                  {choice.path.slice(choice.path.lastIndexOf(".") + 1)}
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
