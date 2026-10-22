import { useEffect, useRef, useState } from "react";
import { colorFromOklab, formatAuthored, formatColor, needsMapping, oklchToOklab, type Oklab } from "../../src/color-math.js";
import type { ConstantTarget, Edit } from "../../src/edit.js";
import type { Color } from "../../src/color-math.js";
import type { SnapshotConstant } from "../../src/snapshot.js";
import type { Change } from "../../src/working-copy.js";
import { EditableChip } from "../ColorChip.js";
import { ColorTip } from "../ColorTip.js";
import { EDITABLE } from "../mode.js";
import { colorNameOf } from "../names.js";
import { paintCss } from "../paint.js";
import { Popup, type PopupPanel } from "../Popup.js";
import { useTrying } from "../preview.js";
import { labelColorOn } from "../Strip.js";

type PaletteEntry = { name: string; path: string; color: Color };

/** A group of constants: `group` is its path in `systems`. */
type Palette = { group: string; entries: PaletteEntry[] };

/** Each group that holds constants of its own, in the order written. Constants in no group are not a palette. */
export function palettesOf(constants: SnapshotConstant[]): Palette[] {
  const palettes: Palette[] = [];
  for (const { path, color } of constants) {
    const cut = path.lastIndexOf(".");
    if (cut === -1) continue;
    const group = path.slice(0, cut);
    let palette = palettes.find((candidate) => candidate.group === group);
    if (!palette) palettes.push((palette = { group, entries: [] }));
    palette.entries.push({ name: path.slice(cut + 1), path, color });
  }
  return palettes;
}

/** Where a new entry's name comes from when the color names cannot be loaded. */
const UNNAMED = "color";

/**
 * Any hue, at a lightness and chroma that read as a color rather than a gray
 * or a near-black. Chroma comes down until sRGB holds it, so the new entry
 * is written as hex.
 */
function randomColor(): Oklab {
  const L = 0.5 + Math.random() * 0.35;
  const H = Math.random() * 360;
  let C = 0.06 + Math.random() * 0.14;
  while (C > 0 && needsMapping(colorFromOklab(oklchToOklab([L, C, H])), "srgb")) C -= 0.005;
  return oklchToOklab([L, Math.max(C, 0), H]);
}

const CONSTANT_KEY = /^[A-Za-z][\w-]*$/;

/** The names a new or renamed constant in `group` cannot take: whatever the group already holds, and the keys a group reserves. */
function takenIn(group: string, written: string[]): string[] {
  const prefix = `${group}.`;
  const held = written.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length).split(".")[0]);
  return [...new Set(["alias", "emit", ...held])];
}

/** A color's name as a constant's key: "Blue Whale" → `blue-whale`, numbered when the set already has it. */
function keyFor(name: string, taken: string[]): string {
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

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * A color the file has starts locked; one added since the last save starts
 * unlocked. Toggling a lock is the browser's alone: it is kept until reload,
 * and never written anywhere.
 */
function useLocks(changes: Change[]) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const added = (path: string) =>
    changes.some((change) => change.action === "set" && change.from == null && change.target.kind === "constant" && change.target.path === path);
  const isLocked = (path: string) => toggled[path] ?? !added(path);
  const toggle = (path: string) => setToggled({ ...toggled, [path]: !isLocked(path) });
  return { added, isLocked, toggle };
}

export function PalettePage({
  palette,
  note,
  written,
  changes,
}: {
  palette: Palette;
  /** The group's hand-written description, or null. */
  note: string | null;
  /** Every path the systems block holds, constants and systems alike. */
  written: string[];
  changes: Change[];
}) {
  const { commitStep } = useTrying();
  const { added, isLocked, toggle } = useLocks(changes);
  const taken = takenIn(palette.group, written);
  /**
   * Every unlocked color gets a new random one. A color the file does not
   * have yet is named after its color, so it is renamed along with it; once
   * saved, its name is frozen, since other lines may point at it.
   */
  const roll = async () => {
    const edits: Edit[] = [];
    const names = [...taken];
    for (const entry of palette.entries) {
      if (isLocked(entry.path)) continue;
      const lab = randomColor();
      const target: ConstantTarget = { kind: "constant", path: entry.path };
      edits.push({ action: "set", target, value: formatAuthored(lab) });
      if (!added(entry.path)) continue;
      const others = names.filter((name) => name !== entry.name);
      const key = keyFor((await colorNameOf(colorFromOklab(lab))) ?? UNNAMED, others);
      if (key === entry.name) continue;
      edits.push({ action: "rename", target, name: key });
      names.splice(names.indexOf(entry.name), 1, key);
    }
    if (edits.length > 0) commitStep(edits);
  };
  const latestRoll = useRef(roll);
  latestRoll.current = roll;

  useEffect(() => {
    if (!EDITABLE) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextField(event.target) || document.querySelector(".popover")) return;
      event.preventDefault();
      latestRoll.current();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="palette-head">
        <h1>
          {palette.group}{" "}
          <span className="muted" style={{ fontSize: "var(--text-body)" }}>
            palette
          </span>
        </h1>
        {EDITABLE && (
          <button
            type="button"
            className="btn"
            disabled={!palette.entries.some((entry) => !isLocked(entry.path))}
            title="Give every unlocked color a new random color"
            onClick={roll}
          >
            randomize
          </button>
        )}
      </div>
      {note && <p className="note">{note}</p>}
      <p className="desc">
        {!EDITABLE
          ? "A group of constants, looked at together."
          : "A group of constants, looked at together. Space rolls every unlocked color; a color the file has starts locked, one added since the last save starts unlocked and takes the name of each color it rolls to. Saving freezes a name."}
      </p>
      <div className="palette-row">
        {palette.entries.map((entry) => (
          <PaletteEntry
            key={entry.path}
            entry={entry}
            taken={taken}
            locked={isLocked(entry.path)}
            onToggleLock={() => toggle(entry.path)}
          />
        ))}
        {EDITABLE && <AddColor group={palette.group} taken={taken} />}
      </div>
    </>
  );
}

/** A random color at the end of the group, named after the nearest named color, to be picked from there. */
function AddColor({ group, taken }: { group: string; taken: string[] }) {
  const { commit } = useTrying();
  const add = async () => {
    const lab = randomColor();
    const name = (await colorNameOf(colorFromOklab(lab))) ?? UNNAMED;
    const key = keyFor(name, taken);
    commit({
      action: "add",
      target: { kind: "constant", path: `${group}.${key}` },
      value: formatAuthored(lab),
    });
  };
  return (
    <button type="button" className="palette-add" aria-label={`Add a color to ${group}`} onClick={add}>
      +
    </button>
  );
}

/** The color opens the picker; under it, the name opens a rename, the lock keeps it out of a roll, and × removes the entry. */
function PaletteEntry({
  entry,
  taken,
  locked,
  onToggleLock,
}: {
  entry: PaletteEntry;
  taken: string[];
  locked: boolean;
  onToggleLock: () => void;
}) {
  const { commit } = useTrying();
  const target: ConstantTarget = { kind: "constant", path: entry.path };
  const swatch = (
    <>
      <span className="palette-entry-fill" style={{ background: paintCss(entry.color) }} />
      <span className="palette-entry-value" style={{ color: labelColorOn(entry.color) }}>
        {formatColor(entry.color, "srgb")}
      </span>
    </>
  );
  if (!EDITABLE) {
    return (
      <div className="palette-entry">
        <ColorTip color={entry.color}>
          <span className="palette-entry-color">{swatch}</span>
        </ColorTip>
        <div className="palette-entry-foot">
          <span className="palette-entry-name">{entry.name}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="palette-entry">
      <EditableChip color={entry.color} target={target} className="palette-entry-color">
        {swatch}
      </EditableChip>
      <div className="palette-entry-foot">
        <Popup title="Rename" className="palette-entry-name" label={entry.name} focus="field">
          {(panel) => <Rename target={target} name={entry.name} taken={taken} panel={panel} />}
        </Popup>
        <button
          type="button"
          className={locked ? "palette-entry-lock palette-entry-locked" : "palette-entry-lock"}
          aria-label={locked ? `Unlock ${entry.name}` : `Lock ${entry.name}`}
          aria-pressed={locked}
          title={locked ? "Locked: a roll leaves it alone" : "Unlocked: a roll gives it a new color"}
          onClick={onToggleLock}
        >
          <LockIcon locked={locked} />
        </button>
        <button
          type="button"
          className="palette-entry-remove"
          aria-label={`Remove ${entry.name}`}
          title="Remove"
          onClick={() => commit({ action: "remove", target })}
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** A new name for the entry, kept on dismiss like every other edit; one that cannot be used is dropped. */
function Rename({ target, name, taken, panel }: { target: ConstantTarget; name: string; taken: string[]; panel: PopupPanel }) {
  const { commit } = useTrying();
  const [text, setText] = useState(name);
  const wanted = text.trim();
  const problem =
    wanted === name
      ? null
      : !CONSTANT_KEY.test(wanted)
        ? "A name starts with a letter and holds letters, digits, - and _."
        : taken.includes(wanted)
          ? `${wanted} is taken.`
          : null;
  const rename = wanted !== name && problem == null ? wanted : null;
  const latest = useRef(rename);
  latest.current = rename;
  useEffect(
    () => () => {
      if (latest.current) commit({ action: "rename", target, name: latest.current });
    },
    [],
  );
  return (
    <form
      className="ref-editor"
      onSubmit={(event) => {
        event.preventDefault();
        panel.dismiss();
      }}
    >
      <div className="editor-head" {...panel.handle}>
        <span className="ref-editor-heading">Rename {name}</span>
        {panel.close}
      </div>
      <input
        className="ref-input"
        type="text"
        aria-label="Name"
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
      />
      {problem && <p className="ref-error">{problem}</p>}
    </form>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="5.5" width="8" height="5.5" rx="1" fill={locked ? "currentColor" : "none"} />
      <path d={locked ? "M4 5.5V3.75a2 2 0 0 1 4 0V5.5" : "M4 5.5V3.75a2 2 0 0 1 3.9-.6"} />
    </svg>
  );
}
