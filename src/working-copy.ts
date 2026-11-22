import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { applyEdits, placedTarget, readValue, renamedTarget, type Edit, type EditTarget, type ConstantTarget, type EntryTarget, type GroupTarget, type ModeTarget, type CollectionTarget, type RoleTarget } from "./edit.js";

/**
 * The definition as it is on disk, the edits made since that are not yet
 * written to it, and the edits taken back that can still be redone.
 * Everything else — the text the app is drawn from, what counts as a change —
 * is worked out from these, so they cannot disagree.
 *
 * Edits come in steps: what one undo takes back. Most steps are one edit; a
 * step that rolls several constants at once is several. `undone` is a
 * stack: its last step is the next one redo brings back.
 */
export type WorkingCopy = { diskText: string; steps: Edit[][]; undone: Edit[][] };

export function openFile(diskText: string): WorkingCopy {
  return { diskText, steps: [], undone: [] };
}

/** Every unsaved edit, in the order it was made. */
export function editsOf(copy: WorkingCopy): Edit[] {
  return copy.steps.flat();
}

/** A new step; whatever could have been redone is gone, as in any editor. */
export function withEdits(copy: WorkingCopy, edits: Edit[]): WorkingCopy {
  return { ...copy, steps: [...copy.steps, edits], undone: [] };
}

export function withEdit(copy: WorkingCopy, edit: Edit): WorkingCopy {
  return withEdits(copy, [edit]);
}

/** The copy without edits the file could not take. A step left with nothing is gone too. */
export function withoutEdits(copy: WorkingCopy, dropped: Edit[]): WorkingCopy {
  const steps = copy.steps
    .map((step) => step.filter((edit) => !dropped.includes(edit)))
    .filter((step) => step.length > 0);
  return { ...copy, steps };
}

export function undo(copy: WorkingCopy): WorkingCopy {
  const last = copy.steps.at(-1);
  if (!last) return copy;
  return { ...copy, steps: copy.steps.slice(0, -1), undone: [...copy.undone, last] };
}

export function redo(copy: WorkingCopy): WorkingCopy {
  const next = copy.undone.at(-1);
  if (!next) return copy;
  return { ...copy, steps: [...copy.steps, next], undone: copy.undone.slice(0, -1) };
}

/**
 * Drop every unsaved edit. It is undo all the way down rather than a wipe,
 * so redo brings the steps back in the order they were made.
 */
export function discard(copy: WorkingCopy): WorkingCopy {
  return { ...copy, steps: [], undone: [...copy.undone, ...[...copy.steps].reverse()] };
}

/**
 * One thing whose working state differs from the file's: a value set, or an
 * entry added (`from` null), renamed, moved or removed. A renamed or removed
 * entry is named by `target` as the file has it; a moved one as it is now. A
 * rename covers a group's, and an entry placed at another path. A system is
 * added or removed whole, its value `{ "algorithm", "params" }` as JSON; a
 * role is added or removed whole, its value its refs as a JSON list.
 */
export type Change =
  | { action: "set"; target: EditTarget; from: string | null; to: string }
  | { action: "rename"; target: EntryTarget | GroupTarget | ModeTarget | CollectionTarget; to: EntryTarget | GroupTarget | ModeTarget | CollectionTarget }
  | { action: "move"; target: ConstantTarget | RoleTarget }
  | { action: "remove"; target: EntryTarget | ModeTarget | CollectionTarget; from: string };

function modeNames(text: string): string[] {
  const modes = parseDocument(text).get("modes", true);
  if (isSeq(modes)) return modes.items.map((item) => String(isScalar(item) ? item.value : item));
  return isMap(modes) ? modes.items.map((item) => String(isScalar(item.key) ? item.key.value : item.key)) : [];
}

const sameTarget = (a: EditTarget, b: EditTarget) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The text with every edit applied. An edit names a color, not a line, so it
 * still applies after the file changes underneath it; one whose color the
 * file no longer has cannot, and comes back in `dropped` rather than failing
 * the rest.
 */
export function workingText(copy: WorkingCopy): {
  text: string;
  dropped: Edit[];
} {
  let text = copy.diskText;
  const dropped: Edit[] = [];
  for (const edit of editsOf(copy)) {
    try {
      text = applyEdits(text, [edit]);
    } catch {
      dropped.push(edit);
    }
  }
  return { text, dropped };
}

/**
 * How `target` is addressed once the entry or group `from` is at `to`: what
 * `from` holds moves with it — a group's entries, a system's params and emit
 * list, a role's refs. Anything else is addressed as before.
 */
function carried(target: EditTarget, from: EditTarget, to: EditTarget): EditTarget {
  const under = (path: string, group: string, now: string) => (path.startsWith(`${group}.`) ? now + path.slice(group.length) : path);
  if (from.kind === "system" && to.kind === "system" && (target.kind === "param" || target.kind === "emit")) {
    return target.system === from.path ? { ...target, system: to.path } : target;
  }
  if (from.kind === "collection" && to.kind === "collection") {
    if ((target.kind === "role" || target.kind === "ref") && target.section === from.name) return { ...target, section: to.name };
    if (target.kind === "group" && target.root === from.name) return { ...target, root: to.name };
    return target;
  }
  if (from.kind === "mode" && to.kind === "mode" && target.kind === "scheme") {
    return target.mode === from.name ? { ...target, mode: to.name } : target;
  }
  if (from.kind === "role" && to.kind === "role" && target.kind === "ref") {
    return target.section === from.section && target.role === from.path ? { ...target, role: to.path } : target;
  }
  if (from.kind !== "group" || to.kind !== "group") return target;
  if (target.kind === "constant" && from.root === "palette") return { ...target, path: under(target.path, from.path, to.path) };
  if (target.kind === "role" && target.section === from.root) return { ...target, path: under(target.path, from.path, to.path) };
  if (target.kind === "ref" && target.section === from.root) return { ...target, role: under(target.role, from.path, to.path) };
  if (target.kind === "group" && target.root === from.root) return { ...target, path: under(target.path, from.path, to.path) };
  return target;
}

/** Whether `target` is written inside `holder`: a role's ref, a system's param or emit list, or anything in a collection. */
function heldBy(target: EditTarget, holder: EditTarget): boolean {
  if (holder.kind === "collection") {
    return ((target.kind === "role" || target.kind === "ref") && target.section === holder.name) || (target.kind === "group" && target.root === holder.name);
  }
  if (holder.kind === "role") return target.kind === "ref" && target.section === holder.section && target.role === holder.path;
  if (holder.kind === "system") return (target.kind === "param" || target.kind === "emit") && target.system === holder.path;
  return false;
}

/**
 * A color followed through the edits: where the file has it, or whether it
 * was added; where it is now (null once removed), and where it would be had
 * only what holds it been renamed; whether what holds it was removed, which
 * is then the one change; and its last value.
 */
type Followed = {
  inFile: EditTarget | null;
  added: boolean;
  moved: boolean;
  now: EditTarget | null;
  unrenamed: EditTarget;
  holderRemoved: boolean;
  value: string | null;
  lastEdit: number;
};

/**
 * What saving would change, one entry per color: its last value against what
 * the file has, and for a constant whether it was added, renamed or
 * removed. A color edited back to the file's value is not a change, however
 * many edits it took to get there, and neither is a rename back.
 */
export function changesOf(copy: WorkingCopy): Change[] {
  const followed: Followed[] = [];
  // How each rename, and each mode removed, readdresses what comes after it.
  const renames: { forward: (target: EditTarget) => EditTarget; back: (target: EditTarget) => EditTarget }[] = [];
  const edits = editsOf(copy);
  const follow = (target: EditTarget): Followed => {
    const known = followed.find((color) => color.now != null && sameTarget(color.now, target));
    if (known) return known;
    // The file has it under the names its holders had before they were renamed.
    const origin = renames.reduceRight((at, { back }) => back(at), target);
    const stillThere = sameTarget(renames.reduce((at, { forward }) => forward(at), origin), target);
    // A name another color was renamed away from is a new color if it comes back.
    const claimed = followed.some((color) => color.inFile != null && sameTarget(color.inFile, origin));
    const inFile = stillThere && !claimed && readValue(copy.diskText, origin) != null ? origin : null;
    const color = { inFile, added: false, moved: false, now: target, unrenamed: target, holderRemoved: false, value: null, lastEdit: -1 };
    followed.push(color);
    return color;
  };
  edits.forEach((edit, index) => {
    const color = follow(edit.target);
    color.lastEdit = index;
    if (edit.action === "add") color.added = true;
    if (edit.action === "set" || edit.action === "add") color.value = edit.value;
    else if (edit.action === "move") color.moved = true;
    else if (edit.action === "remove" && edit.target.kind === "mode") {
      color.now = null;
      const name = edit.target.name;
      // A mode is a place in every ref list: the refs in it go with it, and those after it move up one.
      const at = modeNames(workingText({ ...copy, steps: [edits.slice(0, index)], undone: [] }).text).indexOf(name);
      const shift = (by: number) => (target: EditTarget): EditTarget => (target.kind === "ref" && target.mode > at - (by < 0 ? 0 : 1) ? { ...target, mode: target.mode + by } : target);
      for (const other of followed) {
        if (other.now?.kind === "ref" && other.now.mode === at) other.holderRemoved = true;
        if (other.now?.kind === "scheme" && other.now.mode === name) other.holderRemoved = true;
        if (other.now) other.now = shift(-1)(other.now);
        other.unrenamed = shift(-1)(other.unrenamed);
      }
      renames.push({ forward: shift(-1), back: shift(1) });
    }
    else if (edit.action === "remove") {
      color.now = null;
      for (const other of followed) {
        if (other.now && heldBy(other.now, edit.target)) other.holderRemoved = true;
      }
    }
    else {
      const from = edit.target;
      const to = edit.action === "rename" ? renamedTarget(edit.target, edit.name) : placedTarget(edit.target, edit.path);
      color.now = to;
      for (const other of followed) {
        if (other === color) continue;
        if (other.now) other.now = carried(other.now, from, to);
        other.unrenamed = carried(other.unrenamed, from, to);
      }
      renames.push({ forward: (at) => carried(at, from, to), back: (at) => carried(at, to, from) });
    }
  });

  // A mode added as a copy brings a ref on every role; that is the mode's one change.
  const addedModes = followed.flatMap((color) => (color.added && color.inFile == null && color.now?.kind === "mode" ? [color.now.name] : []));
  const modes = addedModes.length > 0 ? modeNames(workingText(copy).text) : [];
  const changes: { change: Change; lastEdit: number }[] = [];
  for (const { inFile, added, moved, now, unrenamed, holderRemoved, value, lastEdit } of followed) {
    if (holderRemoved) continue;
    if (now?.kind === "ref" && addedModes.includes(modes[now.mode])) continue;
    const push = (change: Change) => changes.push({ change, lastEdit });
    if (inFile == null) {
      // A set on a param the file does not write adds it, as `add` does a constant.
      // A scheme on a mode the file does not have is part of adding it.
      if (now?.kind === "scheme" && value === "") continue;
      if ((added || now?.kind === "param" || now?.kind === "emit" || now?.kind === "scheme") && now != null && value != null) push({ action: "set", target: now, from: null, to: value });
      continue;
    }
    const from = readValue(copy.diskText, inFile)!;
    if (now == null) {
      push({ action: "remove", target: inFile as EntryTarget | ModeTarget | CollectionTarget, from });
      continue;
    }
    if (!sameTarget(now, unrenamed)) push({ action: "rename", target: inFile as EntryTarget | GroupTarget | ModeTarget | CollectionTarget, to: now as EntryTarget | GroupTarget | ModeTarget | CollectionTarget });
    if (moved) push({ action: "move", target: now as ConstantTarget | RoleTarget });
    if (value != null && value !== from) push({ action: "set", target: now, from, to: value });
  }
  return changes.sort((a, b) => a.lastEdit - b.lastEdit).map(({ change }) => change);
}
