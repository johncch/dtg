import { GraphStar, Plus, Target, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { colorFromOklab, formatAuthored, oklabToOklch, oklchToOklab, toOklab, type Oklab } from "../../src/color-math.js";
import type { ConstantTarget, Edit } from "../../src/edit.js";
import { addToPalette, harmonizePalette, harmonyHues, randomColor, rollPalette, type Harmony, type RollStyle } from "../../src/palette-roll.js";
import type { Snapshot, SnapshotConstant, SnapshotGradient } from "../../src/snapshot.js";
import { NO_LOCK, NotAColor, paletteRows } from "../PaletteEntries.js";
import type { Change } from "../../src/working-copy.js";
import { EditableChip } from "../ColorChip.js";
import { ColorTip } from "../ColorTip.js";
import { CONSTANT_COLUMN_COUNT, ConstantsHead, ConstantName, ConstantRow, constantUsers, RESERVED } from "../ConstantRow.js";
import { GripIcon } from "../GripIcon.js";
import { LockIcon } from "../LockIcon.js";
import { Hint } from "../Hint.js";
import { EDITABLE } from "../mode.js";
import { colorNameOf } from "../names.js";
import { isGradient, leadColor, paintCss, type Paint } from "../paint.js";
import { AddRow, ENTRY_NAME, ENTRY_NAME_RULE, EntryRemove, GroupName, openNameOf } from "../EntryRow.js";
import { PaletteExplorer } from "../PaletteExplorer.js";
import type { PaletteEntry } from "../PalettePlots.js";
import { Popup, type PopupPanel } from "../Popup.js";
import { firstError, useTrying } from "../preview.js";
import { labelColorOn } from "../Strip.js";
import { Alert } from "../Alert.js";

/** A group of constants: `group` is its path in `systems`. */
export type Palette = { group: string; entries: PaletteEntry[] };

/**
 * Each group that holds palette entries of its own, in the order written.
 * Entries in no group are not a palette. `entries` are its colors, which is
 * what the color tools work on; a group of gradients alone has none.
 */
export function palettesOf(constants: SnapshotConstant[], gradients: SnapshotGradient[]): Palette[] {
  const palettes: Palette[] = [];
  const paletteAt = (path: string) => {
    const cut = path.lastIndexOf(".");
    if (cut === -1) return null;
    const group = path.slice(0, cut);
    let palette = palettes.find((candidate) => candidate.group === group);
    if (!palette) palettes.push((palette = { group, entries: [] }));
    return palette;
  };
  for (const { path, written, color } of constants) {
    paletteAt(path)?.entries.push({ name: path.slice(path.lastIndexOf(".") + 1), path, written, color });
  }
  for (const { path } of gradients) paletteAt(path);
  return palettes;
}

/** Where a new entry's name comes from when the color names cannot be loaded. */
export const UNNAMED = "color";

const ROLL_STYLES: { value: RollStyle; label: string }[] = [
  { value: "anything", label: "Anything" },
  { value: "tone", label: "Same lightness and chroma" },
];
const HARMONIES: { value: Harmony; label: string }[] = [
  { value: "analogous", label: "Analogous" },
  { value: "complementary", label: "Complementary" },
  { value: "triad", label: "Triad" },
  { value: "even", label: "Evenly spaced" },
];
const ROLL_STYLE_KEY = "dtg.palette.roll-style";

export function storedRollStyle(): RollStyle {
  try {
    const stored = localStorage.getItem(ROLL_STYLE_KEY);
    return ROLL_STYLES.find((style) => style.value === stored)?.value ?? "anything";
  } catch {
    return "anything";
  }
}

/** The names a new or renamed constant in `group` cannot take: whatever the group already holds, and the keys a group reserves. */
function takenIn(group: string, written: string[]): string[] {
  const prefix = `${group}.`;
  const held = written.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length).split(".")[0]);
  return [...new Set([...RESERVED, ...held])];
}

/** A color's name as a constant's key: "Blue Whale" → `blue-whale`, numbered when the set already has it. */
export function keyFor(name: string, taken: string[]): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = /^[a-z]/.test(slug) ? slug : `${UNNAMED}-${slug}`.replace(/-+$/, "");
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}-${n}`;
  return key;
}

/** A palette's page title: its path, whose last part a double click renames, every ref and param naming its colors following. */
function PaletteName({ palette, written }: { palette: Palette; written: string[] }) {
  const { commit } = useTrying();
  const parent = palette.group.split(".").slice(0, -1).join(".");
  const under = parent === "" ? "" : `${parent}.`;
  const beside = written
    .filter((path) => path.startsWith(under) && !path.startsWith(`${palette.group}.`))
    .map((path) => path.slice(under.length).split(".")[0]);
  return (
    <GroupName
      path={palette.group}
      taken={[...RESERVED, ...beside]}
      onRename={(name) => {
        commit({ action: "rename", target: { kind: "group", root: "palette", path: palette.group }, name }, { page: { page: "palette", name: `${under}${name}` } });
      }}
    />
  );
}

/** Beside the sidebar's Palette heading: names a new palette, which starts with one random color. */
export function NewPalette({ working }: { working: Snapshot }) {
  return (
    <Popup
      title="New palette"
      className="nav-add"
      label={
        <>
          <Plus size={14} aria-hidden />
          <span className="sr-only">New palette</span>
        </>
      }
      focus="field"
    >
      {(panel) => <PaletteForm working={working} panel={panel} />}
    </Popup>
  );
}

function PaletteForm({ working, panel }: { working: Snapshot; panel: PopupPanel }) {
  const { commit } = useTrying();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // Refs name constants, systems and roles alike, so a palette cannot share its name with any of them.
  const taken = [
    ...working.constants.map((constant) => constant.path),
    ...working.systems.map((system) => system.system),
    ...working.roles.map((role) => role.group || role.role),
  ].some((path) => path.split(".")[0] === name);
  const problem = name === "" ? null : !ENTRY_NAME.test(name) ? ENTRY_NAME_RULE : taken ? `${name} is already written.` : null;
  return (
    <form
      className="ref-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (name === "" || problem || busy) return;
        setBusy(true);
        const lab = randomColor();
        const key = keyFor((await colorNameOf(colorFromOklab(lab))) ?? UNNAMED, RESERVED);
        const refusal = commit({ action: "add", target: { kind: "constant", path: `${name}.${key}` }, value: formatAuthored(lab) }, { page: { page: "palette", name } });
        if (refusal) {
          setRefused(firstError(refusal));
          setBusy(false);
          return;
        }
        panel.dismiss();
      }}
    >
      <div className="editor-head" {...panel.handle}>
        <span className="ref-editor-heading">New palette</span>
        {panel.close}
      </div>
      <label className="ref-control">
        <span>palette</span>
        <input
          type="text"
          className="ref-input"
          value={name}
          spellCheck={false}
          autoComplete="off"
          data-1p-ignore
          placeholder="brand"
          onChange={(event) => {
            setName(event.target.value.trim());
            setRefused(null);
          }}
        />
      </label>
      {(problem ?? refused) && <Alert className="inline-alert">{problem ?? refused}</Alert>}
      <div className="system-form-actions">
        <button type="submit" className="btn btn-primary" disabled={name === "" || problem != null || busy}>
          Add palette
        </button>
      </div>
    </form>
  );
}

type SwatchSize = "small" | "medium" | "large";
const SWATCH_SIZES: { value: SwatchSize; label: string }[] = [
  { value: "small", label: "List" },
  { value: "medium", label: "Grid" },
  { value: "large", label: "Strip" },
];
const SWATCH_SIZE_KEY = "dtg.palette.swatch-size";

function storedSwatchSize(): SwatchSize {
  try {
    const stored = localStorage.getItem(SWATCH_SIZE_KEY);
    return SWATCH_SIZES.find((size) => size.value === stored)?.value ?? "large";
  } catch {
    return "large";
  }
}

const TOOLS_OPEN_KEY = "dtg.palette.tools-open";

function storedToolsOpen(): boolean {
  try {
    return localStorage.getItem(TOOLS_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

function storeSwatchSize(size: SwatchSize) {
  try {
    localStorage.setItem(SWATCH_SIZE_KEY, size);
  } catch {
    // An embedded or private page may refuse storage; the size then lasts until reload.
  }
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** Whether a palette color was added since the last save. */
export function addedSinceSave(changes: Change[], path: string): boolean {
  return changes.some((change) => change.action === "set" && change.from == null && change.target.kind === "constant" && change.target.path === path);
}

/** The color a new entry in a palette gets: one that fits the colors there, in the Randomize style, around `base` or the first locked one. */
export function newColorFor(palette: Palette, isLocked: (path: string) => boolean, style: RollStyle, base: string | null): Oklab {
  return addToPalette(palette.entries.map((entry) => ({ path: entry.path, lab: toOklab(entry.color), locked: isLocked(entry.path) })), style, base);
}

/**
 * A color the file has starts locked; one added since the last save starts
 * unlocked. Toggling a lock is the browser's alone: it is kept until reload,
 * and never written anywhere.
 */
function useLocks(changes: Change[]) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const added = (path: string) => addedSinceSave(changes, path);
  const isLocked = (path: string) => toggled[path] ?? !added(path);
  const toggle = (path: string) => setToggled({ ...toggled, [path]: !isLocked(path) });
  return { added, isLocked, toggle };
}

export function PalettePage({
  palette,
  note,
  written,
  constants,
  gradients,
  order,
  named,
  changes,
}: {
  palette: Palette;
  /** The group's hand-written description, or null. */
  note: string | null;
  /** Every path the systems block holds, constants and systems alike. */
  written: string[];
  constants: SnapshotConstant[];
  gradients: SnapshotGradient[];
  /** Every palette entry's path, in the order written. */
  order: string[];
  /** Every other name a ref can start with: the systems and the role groups. */
  named: string[];
  changes: Change[];
}) {
  const { commitStep, stepRefusal: refusal } = useTrying();
  const { added, isLocked, toggle } = useLocks(changes);
  const [selected, setSelected] = useState<string | null>(null);
  const [swatchSize, setSwatchSize] = useState(storedSwatchSize);
  const [busy, setBusy] = useState(false);
  const [rollStyle, setRollStyle] = useState(storedRollStyle);
  /** The harmony last applied, whose arms the wheel shows until the colors are rolled. */
  const [shownHarmony, setShownHarmony] = useState<{ base: string; offsets: number[] } | null>(null);
  const [toolsOpen, setToolsOpen] = useState(storedToolsOpen);
  const toolsId = useId();
  const toolsToggle = useRef<HTMLButtonElement>(null);
  const toolsClose = useRef<HTMLButtonElement>(null);
  const previousToolsOpen = useRef(toolsOpen);
  const operating = useRef(false);
  const row = useRef<HTMLDivElement>(null);
  /** The order shown while a color is dragged; the definition changes only when it is dropped. */
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const moveTo = (path: string, order: string[]) => {
    const index = order.indexOf(path);
    const after = index === 0 ? null : order[index - 1].slice(palette.group.length + 1);
    commitStep([{ action: "move", target: { kind: "constant", path }, after }]);
  };
  const entryElements = () => [...(row.current?.querySelectorAll<HTMLElement>("[data-path]") ?? [])];
  /** Where an entry is laid out, in the viewport: its place in the row, whatever transform is moving it. */
  const layoutBox = (element: HTMLElement) => {
    const rowBox = row.current!.getBoundingClientRect();
    const left = rowBox.left + element.offsetLeft - row.current!.offsetLeft;
    const top = rowBox.top + element.offsetTop - row.current!.offsetTop;
    return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight };
  };
  const dragging = useRef<{ path: string; grabbed: { x: number; y: number }; origin: { left: number; top: number }; pointer: { x: number; y: number } } | null>(null);
  const boxesBeforeReorder = useRef(new Map<string, { left: number; top: number }>());
  const followPointer = () => {
    const drag = dragging.current;
    const element = drag && entryElements().find((entry) => entry.dataset.path === drag.path);
    if (!drag || !element) return;
    const box = layoutBox(element);
    const x = drag.pointer.x - drag.grabbed.x - (box.left - drag.origin.left);
    const y = drag.pointer.y - drag.grabbed.y - (box.top - drag.origin.top);
    element.style.transform = `translate(${x}px, ${y}px)`;
  };
  const slide = (element: HTMLElement, from: string) => {
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;
    return element.animate([{ transform: from }, { transform: "none" }], { duration, easing: "ease-out" });
  };
  useLayoutEffect(() => {
    followPointer();
    for (const element of entryElements()) {
      const before = boxesBeforeReorder.current.get(element.dataset.path!);
      if (!before || element.dataset.path === dragging.current?.path) continue;
      const box = layoutBox(element);
      if (before.left !== box.left || before.top !== box.top) {
        slide(element, `translate(${before.left - box.left}px, ${before.top - box.top}px)`);
      }
    }
    boxesBeforeReorder.current.clear();
  }, [dragOrder]);
  useEffect(() => { setDragOrder(null); }, [palette.entries, gradients, refusal]);
  const startDrag = (path: string, pointer: { x: number; y: number }) => {
    const original = tilePaths;
    const element = entryElements().find((entry) => entry.dataset.path === path);
    if (!element) return;
    let order = original;
    dragging.current = { path, grabbed: pointer, origin: layoutBox(element), pointer };
    setDragged(path);
    setDragOrder(order);
    const onMove = (event: PointerEvent) => {
      dragging.current!.pointer = { x: event.clientX, y: event.clientY };
      followPointer();
      // Places are tested where entries are laid out, not where they are drawn: one sliding out from under the pointer would otherwise swap straight back.
      const over = entryElements().find((entry) => {
        const box = layoutBox(entry);
        return event.clientX >= box.left && event.clientX < box.right && event.clientY >= box.top && event.clientY < box.bottom;
      })?.dataset.path;
      if (over == null || over === path) return;
      const next = order.filter((other) => other !== path);
      next.splice(order.indexOf(over), 0, path);
      order = next;
      for (const entry of entryElements()) boxesBeforeReorder.current.set(entry.dataset.path!, layoutBox(entry));
      setDragOrder(next);
    };
    const onEnd = (event: PointerEvent) => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onEnd);
      removeEventListener("pointercancel", onEnd);
      dragging.current = null;
      const dropped = entryElements().find((entry) => entry.dataset.path === path);
      const moved = event.type === "pointerup" && order.some((other, index) => other !== original[index]);
      if (dropped) {
        const from = dropped.style.transform;
        const drawn = dropped.getBoundingClientRect();
        dropped.style.transform = "";
        if (moved) slide(dropped, from);
        else boxesBeforeReorder.current.set(path, { left: drawn.left, top: drawn.top });
      }
      if (moved) moveTo(path, order);
      else {
        for (const entry of entryElements()) {
          if (entry !== dropped) boxesBeforeReorder.current.set(entry.dataset.path!, layoutBox(entry));
        }
        setDragOrder(null);
      }
      setTimeout(() => setDragged((current) => (current === path && !dragging.current ? null : current)), 180);
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onEnd);
    addEventListener("pointercancel", onEnd);
  };
  const nudge = (path: string, by: -1 | 1) => {
    const order = [...tilePaths];
    const index = order.indexOf(path);
    const to = index + by;
    if (to < 0 || to >= order.length) return;
    order.splice(index, 1);
    order.splice(to, 0, path);
    moveTo(path, order);
  };
  const taken = takenIn(palette.group, written);
  const rows = paletteRows(palette.group, constants, gradients, order);
  const paths = [...constants, ...gradients].map((entry) => entry.path);
  const tilePaths = rows.map((row) => row.path);
  // The order shown, which a drag changes; the definition changes only when it is dropped.
  const tiles = (dragOrder ?? tilePaths).flatMap((path): Tile[] => {
    const row = rows.find((candidate) => candidate.path === path);
    return row ? [{ name: path.slice(palette.group.length + 1), path, written: row.written, color: row.paint, users: constantUsers(row) }] : [];
  });
  const add = async (color?: Oklab, after?: string, openName = false) => {
    if (operating.current) return;
    operating.current = true;
    setBusy(true);
    try {
      const lab = color ?? newColorFor(palette, isLocked, rollStyle, selected);
      const key = keyFor((await colorNameOf(colorFromOklab(lab))) ?? UNNAMED, taken);
      const path = `${palette.group}.${key}`;
      if (openName) openNameOf(path);
      commitStep([{ action: "add", target: { kind: "constant", path }, value: formatAuthored(lab), after }]);
    } finally {
      operating.current = false;
      setBusy(false);
    }
  };
  /**
   * Every unlocked color gets a new random one. A color the file does not
   * have yet is named after its color, so it is renamed along with it; once
   * saved, its name is frozen, since other lines may point at it.
   */
  const roll = async (style = rollStyle) => {
    if (operating.current) return;
    setShownHarmony(null);
    operating.current = true;
    setBusy(true);
    try {
      const edits: Edit[] = [];
      const names = [...taken];
      // A style falls back on the first locked color as its base; selecting it shows which color that was.
      const base = style === "anything" ? selected : (selectedEntry ?? firstLocked)?.path ?? null;
      let nextSelected = base;
      const rolled = rollPalette(
        palette.entries.map((entry) => ({ path: entry.path, lab: toOklab(entry.color), locked: isLocked(entry.path) })),
        style,
        base,
      );
      for (const entry of palette.entries) {
        const lab = rolled.get(entry.path);
        if (!lab) continue;
        const target: ConstantTarget = { kind: "constant", path: entry.path };
        edits.push({ action: "set", target, value: formatAuthored(lab, entry.color.alpha) });
        if (!added(entry.path)) continue;
        const others = names.filter((name) => name !== entry.name);
        const key = keyFor((await colorNameOf(colorFromOklab(lab))) ?? UNNAMED, others);
        if (key === entry.name) continue;
        edits.push({ action: "rename", target, name: key });
        names.splice(names.indexOf(entry.name), 1, key);
        if (base === entry.path) nextSelected = `${palette.group}.${key}`;
      }
      if (edits.length > 0) commitStep(edits);
      setSelected(nextSelected);
    } finally {
      operating.current = false;
      setBusy(false);
    }
  };
  const chooseRollStyle = (style: RollStyle) => {
    setRollStyle(style);
    try {
      localStorage.setItem(ROLL_STYLE_KEY, style);
    } catch {
      // The choice still holds for this visit.
    }
    roll(style);
  };
  const selectedEntry = palette.entries.find((entry) => entry.path === selected);
  const firstLocked = palette.entries.find((entry) => isLocked(entry.path));
  const harmonyBase = selectedEntry ?? firstLocked ?? palette.entries[0];
  const harmonyBaseLabel = !harmonyBase ? "none"
    : harmonyBase === selectedEntry ? harmonyBase.name
      : `${harmonyBase.name} (${harmonyBase === firstLocked ? "first locked" : "first color"})`;
  const rollColors = palette.entries.map((entry) => ({ path: entry.path, lab: toOklab(entry.color), locked: isLocked(entry.path) }));
  // The arms stay around the base they were drawn for, whatever is selected since.
  const hueOfEntry = (entry: PaletteEntry) => oklabToOklch(toOklab(entry.color))[2];
  const armsBase = shownHarmony && palette.entries.find((entry) => entry.path === shownHarmony.base);
  // Kept as angles from the base, so the arms turn with it as one piece and are not worked out afresh from colors that have since moved.
  const harmonyGuides = shownHarmony && armsBase ? shownHarmony.offsets.map((offset) => (hueOfEntry(armsBase) + offset + 360) % 360) : [];
  const harmonize = (harmony: Harmony) => {
    if (operating.current || !harmonyBase) return;
    const moved = harmonizePalette(rollColors, harmony, harmonyBase.path);
    setShownHarmony({
      base: harmonyBase.path,
      offsets: harmonyHues(rollColors, harmony, harmonyBase.path).map((hue) => hue - hueOfEntry(harmonyBase)),
    });
    const edits: Edit[] = [];
    for (const entry of palette.entries) {
      const lab = moved.get(entry.path);
      if (!lab) continue;
      const value = formatAuthored(lab, entry.color.alpha);
      if (value !== entry.written) edits.push({ action: "set", target: { kind: "constant", path: entry.path }, value });
    }
    setSelected(harmonyBase.path);
    if (edits.length > 0) commitStep(edits);
  };
  const latestRoll = useRef(roll);
  latestRoll.current = roll;

  useEffect(() => {
    if (!EDITABLE) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextField(event.target) || document.querySelector(".popover")) return;
      if (event.target instanceof Element && event.target.closest(".palette-tools-toggle, .palette-tools-close, .palette-entry-add, .palette-empty-add, .palette-roll-style, .palette-harmony, .palette-visual-control")) return;
      event.preventDefault();
      latestRoll.current();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);


  useEffect(() => {
    if (previousToolsOpen.current === toolsOpen) return;
    previousToolsOpen.current = toolsOpen;
    try {
      localStorage.setItem(TOOLS_OPEN_KEY, String(toolsOpen));
    } catch {
      // An embedded or private page may refuse storage; the sidebar then starts closed on reload.
    }
    (toolsOpen ? toolsClose : toolsToggle).current?.focus();
  }, [toolsOpen]);

  return (
    <>
      <div className="palette-head">
        <h1 className="entry-head palette-title">
          <PaletteName palette={palette} written={written} />
          <span className="title-kind">
            palette
          </span>
        </h1>
        <div className="palette-view-controls palette-swatch-size" role="group" aria-label="Palette layout">
          {SWATCH_SIZES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className="palette-view-mode"
              aria-pressed={swatchSize === value}
              onClick={() => { setSwatchSize(value); storeSwatchSize(value); }}
            >
              {label}
            </button>
          ))}
        </div>
        <Hint text="Color tools">
          <button
            ref={toolsToggle}
            type="button"
            className="palette-tools-toggle"
            aria-label="Color tools"
            aria-expanded={toolsOpen}
            aria-controls={toolsId}
            data-state={toolsOpen ? "open" : "closed"}
            onClick={() => setToolsOpen(!toolsOpen)}
          >
            <GraphStar size={16} aria-hidden />
          </button>
        </Hint>
        {EDITABLE && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !palette.entries.some((entry) => !isLocked(entry.path))}
            title="Give every unlocked color a new random color"
            onClick={() => roll()}
          >
            Randomize
          </button>
        )}
      </div>
      {note && <p className="note">{note}</p>}
      {refusal && <Alert className="page-alert">{firstError(refusal)}</Alert>}
      {EDITABLE && palette.entries.length === 0 && (
        <p>
          <button type="button" className="btn palette-empty-add" disabled={busy} onClick={() => add()}>
            Add a color
          </button>
        </p>
      )}
      {swatchSize === "small" ? (
        <table className="palette-table">
          <ConstantsHead />
          <tbody>
            {rows.map((row) => (
              <ConstantRow
                key={row.path}
                constant={row}
                paths={paths}
                named={named}
                siblings={rows}
                onPalettePage
                lock={EDITABLE ? { locked: isLocked(row.path), onToggle: () => toggle(row.path) } : null}
              />
            ))}
            <AddRow label="New color" columns={CONSTANT_COLUMN_COUNT} busy={busy} onAdd={() => add(undefined, undefined, true)} />
          </tbody>
        </table>
      ) : (
        <div ref={row} className={`palette-row palette-row-${swatchSize}${dragged ? " is-reordering" : ""}`}>
          {tiles.map((entry) => (
            <PaletteEntry
              key={entry.path}
              entry={entry}
              paths={paths}
              named={named}
              locked={isLocked(entry.path)}
              large={swatchSize === "large"}
              onToggleLock={() => toggle(entry.path)}
              onAddAfter={() => add(undefined, entry.name)}
              dragging={entry.path === dragged}
              onDragStart={(pointer) => startDrag(entry.path, pointer)}
              onNudge={(by) => nudge(entry.path, by)}
              selected={entry.path === selected}
              onToggleSelect={() => {
                if (entry.path === selected) {
                  setSelected(null);
                  return;
                }
                setSelected(entry.path);
                setToolsOpen(true);
              }}
              onRepath={(path) => { if (selected === entry.path) setSelected(path); }}
              lastOfPalette={rows.length === 1}
            />
          ))}
        </div>
      )}
      <section
        id={toolsId}
        className="palette-tools"
        aria-label="Color tools"
        hidden={!toolsOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !document.querySelector(".popover")) {
            event.preventDefault();
            setToolsOpen(false);
          }
        }}
      >
        {toolsOpen && (
          <>
            <button
              ref={toolsClose}
              type="button"
              className="editor-close palette-tools-close"
              aria-label="Close color tools"
              onClick={() => setToolsOpen(false)}
            >
              <X size={16} aria-hidden />
            </button>
            <h2 className="palette-tools-title">Color tools</h2>
            <div className="palette-tools-body">
              {EDITABLE && (
                <section className="palette-tools-section">
                  <h3>Randomize</h3>
                  <div className="palette-tools-fields">
                    <label htmlFor={`${toolsId}-style`}>Style</label>
                    <select
                      id={`${toolsId}-style`}
                      className="palette-roll-style"
                      value={rollStyle}
                      disabled={busy}
                      onChange={(event) => chooseRollStyle(event.target.value as RollStyle)}
                    >
                      {ROLL_STYLES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                </section>
              )}
              {EDITABLE && (
                <section className="palette-tools-section">
                  <h3>Harmonize</h3>
                  <div className="palette-tools-fields">
                    <span>Base</span>
                    <span>{harmonyBaseLabel}</span>
                  </div>
                  <div className="palette-harmonies">
                    {HARMONIES.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        className="btn btn-small palette-harmony"
                        disabled={busy || !palette.entries.some((entry) => entry !== harmonyBase && !isLocked(entry.path))}
                        onClick={() => harmonize(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <section className="palette-tools-section">
                <h3>Colors</h3>
                <PaletteExplorer
                  entries={palette.entries}
                  selected={selected}
                  onSelect={setSelected}
                  onAdd={(channels) => add(oklchToOklab(channels))}
                  isLocked={isLocked}
                  guides={harmonyGuides}
                />
              </section>
            </div>
          </>
        )}
      </section>
    </>
  );
}

/** A palette entry as its tile draws it: a color, or a gradient written among the colors. */
type Tile = Omit<PaletteEntry, "color"> & { color: Paint; users: string[] };

function PaletteEntry({
  entry,
  paths,
  named,
  locked,
  large,
  onToggleLock,
  onAddAfter,
  dragging,
  onDragStart,
  onNudge,
  selected,
  onToggleSelect,
  onRepath,
  lastOfPalette,
}: {
  entry: Tile;
  /** Every path written in the palette, its own among them. */
  paths: string[];
  /** Every other name a ref can start with: the systems and the role groups. */
  named: string[];
  locked: boolean;
  /** Removing it removes the palette, and with it this page. */
  lastOfPalette: boolean;
  /** The swatch is big enough to carry its labels and controls on the color. */
  large: boolean;
  onToggleLock: () => void;
  onAddAfter: () => void;
  dragging: boolean;
  onDragStart: (pointer: { x: number; y: number }) => void;
  onNudge: (by: -1 | 1) => void;
  selected: boolean;
  onToggleSelect: () => void;
  onRepath: (path: string) => void;
}) {
  const { commit } = useTrying();
  const target: ConstantTarget = { kind: "constant", path: entry.path };
  const swatch = <span className="palette-entry-fill" style={{ background: paintCss(entry.color) }} />;
  const value = <span className="palette-entry-value">{entry.written}</span>;
  const onColor = { "--palette-entry-on": labelColorOn(leadColor(entry.color)) } as CSSProperties;
  /** A gradient is no color for the tools to work on: it is not a base, and never rolled, so its lock cannot be turned. */
  const gradient = isGradient(entry.color);
  const hintSide = "left";
  const selectControl = (
    <button
      type="button"
      className="palette-entry-select"
      aria-label={selected ? `${entry.name} is the base; clear it` : `Set ${entry.name} as the base`}
      aria-pressed={selected}
      onClick={onToggleSelect}
    >
      <Target size={14} aria-hidden />
    </button>
  );
  const held = locked && !gradient;
  const select = gradient ? <NotAColor className="palette-entry-mark" /> : <Hint text={selected ? "Base" : "Set base"}>{selectControl}</Hint>;
  const handle = (
    <Hint text="Drag to reorder" side={hintSide}>
      <button
        type="button"
        className="palette-entry-handle"
        aria-label={`Move ${entry.name}; Left and Right arrows move it too`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          onDragStart({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onNudge(-1);
          if (event.key === "ArrowRight") onNudge(1);
        }}
      >
        <GripIcon />
      </button>
    </Hint>
  );
  if (!EDITABLE) {
    return (
      <div className={`palette-entry${selected ? " is-selected" : ""}`} style={onColor}>
        <ColorTip color={entry.color} inside={large}>
          <div className="palette-entry-color">{swatch}</div>
        </ColorTip>
        <div className="palette-entry-foot">
          {select}
          {value}
          <span className="palette-entry-name">{entry.name}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`palette-entry${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}`} style={onColor} data-path={entry.path}>
      <EditableChip color={entry.color} value={entry.written} target={target} className="palette-entry-color" tipInside={large} onUnlock={locked && !gradient ? onToggleLock : undefined}>
        {swatch}
      </EditableChip>
      <div className="palette-entry-foot">
        <span className="palette-entry-actions">
          <Hint text={gradient ? NO_LOCK : locked ? "Unlock" : "Lock"} side={hintSide}>
            <button
              type="button"
              className={locked && !gradient ? "palette-entry-lock palette-entry-locked" : "palette-entry-lock"}
              aria-label={gradient ? `${entry.name} has no lock` : locked ? `Unlock ${entry.name}` : `Lock ${entry.name}`}
              aria-pressed={gradient ? undefined : locked}
              // Not `disabled`: a disabled button gets no pointer events, so its hint would never show.
              aria-disabled={gradient}
              onClick={gradient ? undefined : onToggleLock}
            >
              <LockIcon locked={gradient || locked} />
            </button>
          </Hint>
          {handle}
          <EntryRemove
            label={entry.path}
            users={entry.users}
            stays={held ? "Unlock to delete" : null}
            hint={lastOfPalette ? "Delete, and the palette with it" : "Delete"}
            className="palette-entry-remove"
            side={hintSide}
            onRemove={() => commit({ action: "remove", target })}
          />
        </span>
        {select}
        {value}
        <span className="palette-entry-name">
          <ConstantName path={entry.path} paths={paths} named={named} onRepath={onRepath} />
        </span>
      </div>
      <span className="palette-entry-gap">
        <Hint text="Add color">
          <button type="button" className="palette-entry-add" aria-label={`Add a color after ${entry.name}`} onClick={onAddAfter}>
            <Plus aria-hidden />
          </button>
        </Hint>
      </span>
    </div>
  );
}
