import { Blend, Boxes, CornerLeftUp, Palette, Pipette, SquareFunction, SwatchBook, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import type { SnapshotConstant, SnapshotGradient, SnapshotSystem } from "../../src/snapshot.js";
import { ColorFacts, ColorTip } from "../ColorTip.js";
import { useProjectGamut } from "../gamut.js";
import { Alert } from "../Alert.js";
import { Hint } from "../Hint.js";
import { isGradient, paintCss, paintIsOpaque, type Paint } from "../paint.js";
import type { PopupPanel } from "../Popup.js";
import { firstError, useTrying } from "../preview.js";
import type { ResolvedGradientRef } from "../../src/resolve.js";
import { GradientControls } from "./GradientControls.js";
import { Picker } from "./Picker.js";
import {
  carriedOver,
  pointingOf,
  refOf,
  StepControls,
} from "./StepControls.js";

/** Where a value can be chosen from. Each surface offers the ones its grammar allows, first one default. */
export type Source = "picker" | "palette" | "systems" | "roles" | "gradient";

/** What the value being tried comes to: a color, or the reason it cannot be drawn. */
export type Drawn =
  | { kind: "color"; color: Color }
  /** `headline` says what went wrong where the error's own words would not; names in `error` are written in backticks. */
  | { kind: "refused"; error: string; headline?: string };

export type Choice = { path: string; color: Paint };

export function lchOf(color: Color): Oklch {
  const [L, C, H] = oklabToOklch(toOklab(color));
  // A gray has no hue; start the bar at 0 rather than at a rounding error.
  return C < NO_HUE_BELOW_CHROMA ? [L, 0, 0] : [L, C, H];
}

const SOURCE_LABEL: Record<Source, string> = {
  picker: "Solid color",
  palette: "Palette",
  systems: "Systems",
  roles: "Roles",
  gradient: "Gradient",
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
  gradient = null,
  paletteGradients = [],
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
  /** The roles that can be pointed at, as each is in the mode being edited. One that is a gradient is offered only where the value may be a gradient. */
  roles?: Choice[];
  /** Functions offers `transparent(ref pct)` over any source but a solid color: only where the value is a ref. */
  transparent?: boolean;
  /** The mode this one extends and the ref it would take from it, on a role in such a mode. */
  inherits?: { mode: string; ref: string } | null;
  /** What the value comes to as drawn now, when that is a gradient: the gradient controls show it and its stops' colors. */
  gradient?: ResolvedGradientRef | null;
  /** The palette's gradients, offered beside its colors where the value may be a gradient. */
  paletteGradients?: SnapshotGradient[];
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
  // A palette gradient is a choice like a palette color, wherever a gradient may be chosen at all.
  const inPalette: Choice[] = [
    ...constants.map(({ path, color }) => ({ path, color })),
    ...(sources.includes("gradient") ? paletteGradients.map((named) => ({ path: named.path, color: named.gradient })) : []),
  ];
  const colorRoles = roles.filter((role) => !isGradient(role.color));
  const pointable = sources.includes("gradient") ? roles : colorRoles;
  const [text, setText] = useState(original);
  const trimmed = text.trim();
  // The text is state so a value can arrive from any control; nothing types it directly.
  const [source, setSource] = useState<Source>(
    () => sourceOf(fadedOf(original)?.inner ?? original, sources, inPalette, systems, pointable) ?? sources[0],
  );
  const [lch, setLch] = useState(() => lchOf(originalColor));
  const [stepped, setStepped] = useState(false);
  const lastGood = useRef(originalColor);
  if (drawn.kind === "color") lastGood.current = drawn.color;
  const current = lastGood.current;
  // Every source writes what is chosen; transparent() wraps it.
  const faded = fadedOf(trimmed);
  const inner = faded?.inner ?? trimmed;
  const opacity = faded?.opacity ?? null;
  // The color as drawn is already faded; the picker's own alpha is the one before it.
  const alpha = colorOrNull(inner)?.alpha ?? (opacity ? Math.min(1, current.alpha / (opacity / 100)) : current.alpha);

  const tried = trimmed !== original && trimmed !== "" ? trimmed : null;
  const refused = tried != null && drawn.kind === "refused";
  const latest = useRef({ tried, refused, onCommit, onPreview, text });
  latest.current = { tried, refused, onCommit, onPreview, text };
  const form = useRef<HTMLFormElement>(null);
  // A gradient is changed many times in one sitting, so its changes are kept
  // as steps to go back and forth through while the panel is open.
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  /** `continuing` is the same change still under way, a drag or a pick being tried, which is one step with the change before it. */
  const takeStep = (next: string, continuing = false) => {
    if (next === latest.current.text) return;
    if (!continuing) {
      past.current.push(latest.current.text);
      future.current = [];
    }
    setText(next);
  };
  useEffect(() => onPreview(tried), [tried]);
  useEffect(
    () => () => {
      // A refused value was already said to be refused, in the panel; closing drops it without saying so again.
      if (latest.current.tried != null && !latest.current.refused && !panel.escaped())
        latest.current.onCommit(latest.current.tried);
      else latest.current.onPreview(null);
    },
    [],
  );

  // With a pick in progress, undo means "not this pick": it is not in the
  // history yet, so there is nothing else for the shortcut to take back first.
  // Where the pick was made in steps, it takes them back one at a time.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      // A panel opened over this one has the shortcut while it is open.
      if (!(target instanceof Node) || !form.current?.closest(".popover")?.contains(target)) return;
      const typesText = target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === "text");
      if ((past.current.length > 0 || future.current.length > 0) && !typesText) {
        // Past the first step there is nothing of this panel's to take back, and the page's own history is not its to touch.
        event.preventDefault();
        const [from, to] = event.shiftKey ? [future.current, past.current] : [past.current, future.current];
        // A pick that was tried and dropped leaves a step that changes nothing; it is passed over.
        let step = from.pop();
        while (step === latest.current.text) step = from.pop();
        if (step == null) return;
        to.push(latest.current.text);
        setText(step);
        return;
      }
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement;
      if (event.shiftKey || typing || latest.current.tried == null) return;
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

  const inheriting = trimmed === INHERIT;
  /** Whether a ref names a gradient: the one being edited, or one in the palette or the roles. */
  const namesGradient = (ref: string) =>
    (ref === original && gradient != null) || [...inPalette, ...roles].some((choice) => choice.path === ref && isGradient(choice.color));
  const [inFunctions, setInFunctions] = useState(false);
  const pick = (next: Source | typeof INHERITED) => {
    setInFunctions(false);
    if (next === INHERITED) {
      setText(INHERIT);
      return;
    }
    if (next === "picker") setLch(lchOf(current));
    setSource(next);
    // A gradient starts flat, from the value it replaces, so it reads and draws at once.
    if (next === "gradient" && !writesGradient(basis))
      setText(fade(namesGradient(basis) ? `gradient(${basis})` : `gradient(${basis} ${basis})`));
    // Leaving the gradient takes its text with it: back to what the editor opened on,
    // or where that was a gradient too, to the color the picker starts from.
    else if (next !== "gradient" && writesGradient(inner) && !writesGradient(original))
      setText(original);
    else if (next === "picker" && writesGradient(inner))
      setText(fade(formatAuthored(oklchToOklab(lchOf(current)), alpha)));
    else if (inheriting && next !== "systems")
      setText(inherits?.ref ?? "");
  };
  // Leaving inheritance starts from the ref that was inherited, not from nothing.
  const basis = inheriting && inherits ? inherits.ref : inner;
  const fade = (next: string) => (opacity == null ? next : transparentRef(next, opacity));
  const offersFunctions = transparent && !inheriting;
  // Functions is a tab beside the sources; the source stays marked, since what it picked is what a function wraps.
  const shown: Source | "functions" = inFunctions && offersFunctions ? "functions" : source;
  const fadeTo = (next: number | null, continuing = false) => {
    const written = next == null ? basis : transparentRef(basis, next);
    if (source === "gradient") takeStep(written, continuing);
    else take(written);
  };
  const pointing = pointingOf(basis, systems, inPalette);
  const chosenConstant = pointing?.kind === "constant" ? pointing : null;
  const chosenRole = pointable.find((role) => role.path === basis) ?? null;
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

  return (
    <form
      ref={form}
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
            <span className="editor-sources" role="group" aria-label="From">
              {inherits && (
                <Hint text={`Inherit from ${inherits.mode}`}>
                  <button type="button" className="editor-source-mode" aria-label={`Inherit from ${inherits.mode}`} aria-pressed={inheriting} onClick={() => pick(INHERITED)}>
                    <CornerLeftUp size={16} aria-hidden />
                  </button>
                </Hint>
              )}
              {sources.map((candidate) => (
                <Hint key={candidate} text={SOURCE_LABEL[candidate]}>
                  <button
                    type="button"
                    className="editor-source-mode"
                    aria-label={SOURCE_LABEL[candidate]}
                    aria-pressed={!inheriting && source === candidate}
                    onClick={() => pick(candidate)}
                  >
                    <SourceIcon source={candidate} />
                  </button>
                </Hint>
              ))}
              {offersFunctions && (
                <>
                  <span className="editor-sources-divider" aria-hidden />
                  <Hint text="Functions">
                    <button
                      type="button"
                      className="editor-source-mode"
                      aria-label="Functions"
                      aria-pressed={inFunctions}
                      onClick={() => setInFunctions(true)}
                    >
                      <SquareFunction size={16} aria-hidden />
                    </button>
                  </Hint>
                </>
              )}
            </span>
          )}
        </span>
        {panel.close}
      </div>

      {tried != null && drawn.kind === "refused" && (
        <Alert className="editor-refusal">
          <strong>{drawn.headline ?? "Not applied."}</strong> {withNames(firstError(drawn.error))}
        </Alert>
      )}
      <div className="editor-body">
        {shown === "picker" && (
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
              {/* Back to what it was makes sense only where that was a color. */}
              {!writesGradient(original) && !namesGradient(original) && (
                <Hint text={`Reset to ${original}`}>
                  <button
                    type="button"
                    className="editor-reset"
                    aria-label={`Reset to ${original}`}
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
                </Hint>
              )}
              <label className="picker-steps">
                <input type="checkbox" checked={stepped} onChange={(event) => setStepped(event.target.checked)} />
                steps
              </label>
            </div>
            <Picker
              value={lch}
              gamut={gamut}
              stepped={stepped}
              alpha={alpha}
              onChange={(next) => {
                setLch(next);
                setText(fade(formatAuthored(oklchToOklab(next), alpha)));
              }}
              onAlpha={(next) => setText(fade(formatAuthored(oklchToOklab(lch), next)))}
            />
          </>
        )}
        {shown === "palette" && (
          <ChoiceGrid
            choices={inPalette}
            chosen={chosenConstant?.path ?? null}
            onChoose={(path) => take(fade(path))}
          />
        )}
        {shown === "gradient" && (
          <GradientControls
            text={basis}
            drawn={tried != null && drawn.kind === "refused" ? null : gradient}
            // A palette gradient holds the palette's own colors; any other, whatever its value could be.
            stopSources={sources.includes("roles") ? sources.filter((candidate) => candidate !== "gradient") : ["picker", "palette"]}
            constants={constants}
            systems={systems}
            roles={colorRoles}
            gradients={[...inPalette, ...roles].filter((choice) => isGradient(choice.color))}
            onChange={(next, continuing) => takeStep(fade(next), continuing)}
          />
        )}
        {shown === "roles" && (
          <ChoiceGrid
            choices={pointable}
            chosen={chosenRole?.path ?? null}
            onChoose={(path) => take(fade(path))}
          />
        )}
        {shown === "systems" && (
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
                    fade(
                      refOf({
                        kind: "step",
                        system,
                        selector: carriedOver(pointing, system.selector),
                      }),
                    ),
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
                onChange={(next) => take(fade(refOf(next)))}
              />
            )}
          </div>
        )}

        {shown === "systems" && (
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

        {shown === "functions" && (
          <div className="editor-functions">
            <label className="editor-function">
              <input
                type="checkbox"
                disabled={basis === ""}
                checked={opacity != null}
                onChange={(event) => fadeTo(event.target.checked ? 50 : null)}
              />
              <span>Transparent</span>
            </label>
            <label className="ref-control editor-function-controls">
              <span>opacity</span>
              <input
                type="range"
                min={0}
                max={100}
                step={0.5}
                disabled={opacity == null}
                value={opacity ?? 50}
                onChange={(event) => fadeTo(Number(event.target.value), true)}
              />
              <input
                className="ref-number"
                type="number"
                min={0}
                max={100}
                step={0.5}
                disabled={opacity == null}
                value={opacity ?? 50}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (next >= 0 && next <= 100) fadeTo(next, true);
                }}
              />
            </label>
          </div>
        )}
      </div>
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
  "drawn" | "onPreview" | "onCommit"
>) {
  const { preview, commit, refusal } = useTrying();
  const drawn: Drawn = !refusal
    ? { kind: "color", color }
    : (kindRefused(refusal, target) ?? { kind: "refused", error: `- ${concise(firstError(refusal))}` });
  return (
    <ValueEditor
      {...editor}
      drawn={drawn}
      onPreview={(value) =>
        preview(value == null ? null : { action: "set", target, value })
      }
      onCommit={(value) => commit({ action: "set", target, value })}
    />
  );
}

/**
 * A palette entry that cannot change between a color and a gradient is refused
 * by whatever uses it, in that thing's own words, which do not say what changed.
 * This says it plainly: what it cannot be, and what uses it as the other.
 */
function kindRefused(refusal: string, target: EditTarget): Drawn | null {
  const path = target.kind === "constant" ? target.path : target.kind === "ref" ? target.role : null;
  if (path == null) return null;
  const complaint = firstError(refusal);
  const user = /^([\w.-]+)\[[^\]]*\]:/.exec(complaint)?.[1];
  const who = user ? `\`${user}\`` : "Something";
  const name = `\`${path}\``;
  // A palette color is often reached through a role that points at it, so the complaint names that role and not it.
  const madeGradient = target.kind === "constant" ? / is a gradient/.test(complaint) && !complaint.includes(`${path} is a color`) : complaint.includes(`got ${path} as a stop`) || complaint.includes(`${path} is a gradient`);
  if (madeGradient) {
    return { kind: "refused", headline: "Can't be a gradient:", error: `- ${who} uses ${name} as a color.` };
  }
  if (complaint.includes(`one gradient to restyle — ${path} is a color`)) {
    return { kind: "refused", headline: "Can't be a color:", error: `- ${who} uses ${name} as a gradient.` };
  }
  return null;
}

/**
 * A resolver's complaint as the editor says it: without the place it is about, which is the
 * thing open in the editor, or the function name, or the advice after the dash, which is for
 * someone writing the file. A stop's complaint is said in the editor's own words.
 */
function concise(complaint: string): string {
  const said = complaint.replace(/^[\w.-]+\[[^\]]*\]: /, "").replace(/^[a-z]+\(\) /, "");
  const stop = /^got (\S+) as a stop, and it is a gradient/.exec(said);
  if (stop) return `\`${stop[1]}\` is a gradient, and a stop is a color.`;
  const short = said.split(" — ")[0];
  return short.charAt(0).toUpperCase() + short.slice(1) + (short.endsWith(".") ? "" : ".");
}

/** A message with every name in backticks set in the monospace face. */
function withNames(message: string): ReactNode[] {
  return message.split(/`([^`]+)`/).map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part));
}

/** The sources a value can be edited from, by what is written at a target. */
export function sourcesFor(target: EditTarget): Source[] {
  if (target.kind === "ref") return ["picker", "gradient", "palette", "systems", "roles"];
  if (target.kind === "constant") return ["picker", "gradient"];
  return ["picker", "palette"];
}

/** Which source the written value came from, or null when it does not read as any. */
function sourceOf(
  written: string,
  sources: Source[],
  constants: { path: string }[],
  systems: SnapshotSystem[],
  roles: Choice[],
): Source | null {
  const has = (source: Source) => sources.includes(source);
  if (has("gradient") && writesGradient(written)) return "gradient";
  if (has("picker") && colorOrNull(written)) return "picker";
  if (has("roles") && roles.some((role) => role.path === written))
    return "roles";
  const pointing = pointingOf(written, systems, constants);
  if (has("palette") && pointing?.kind === "constant") return "palette";
  if (has("systems") && pointing?.kind === "step") return "systems";
  return null;
}

function writesGradient(written: string): boolean {
  return written.startsWith("gradient(");
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
  const named = roles.find((role) => role.path === written)?.color;
  return (
    colorOrNull(written) ??
    constants.find((constant) => constant.path === written)?.color ??
    (named && !isGradient(named) ? named : null)
  );
}

function transparentRef(path: string, opacity: number): string {
  return formatRef("transparent", `${path} ${opacity}`);
}

/** The ref inside `transparent(ref pct)` and its opacity, or null when the value is not one. */
function fadedOf(written: string): { inner: string; opacity: number } | null {
  const match = /^transparent\(\s*(.+?)\s+(\S+)\s*\)$/s.exec(written);
  if (!match) return null;
  const opacity = Number(match[2]);
  return opacity >= 0 && opacity <= 100 ? { inner: match[1], opacity } : null;
}

/** Named colors by group, the ungrouped ones first; choosing one names it. */
/** Each source as an icon, the way a design tool marks a fill's kind. */
const SOURCE_ICON: Record<Source, LucideIcon> = {
  picker: Pipette,
  gradient: Blend,
  palette: Palette,
  systems: Boxes,
  roles: SwatchBook,
};

function SourceIcon({ source }: { source: Source }) {
  const Icon = SOURCE_ICON[source];
  return <Icon size={16} aria-hidden />;
}

export function ChoiceGrid({
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

function swatchClass(color: Paint, role: string): string {
  return `swatch ${role}${paintIsOpaque(color) ? "" : " swatch-alpha"}`;
}
