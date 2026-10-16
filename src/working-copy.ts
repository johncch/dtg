import { applyEdits, readValue, renamedTarget, type Edit, type EditTarget, type ConstantTarget } from "./edit.js";

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
 * One color whose working state differs from the file's. A constant can
 * also be added (`from` null), renamed, or removed, and `target` then names
 * it as the file has it.
 */
export type Change =
  | { action: "set"; target: EditTarget; from: string | null; to: string }
  | { action: "rename"; target: ConstantTarget; to: ConstantTarget }
  | { action: "remove"; target: ConstantTarget; from: string };

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

/** A color followed through the edits: where the file has it, or whether it was added, where it is now (null once removed), and its last value. */
type Followed = {
  inFile: EditTarget | null;
  added: boolean;
  now: EditTarget | null;
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
  const follow = (target: EditTarget): Followed => {
    const known = followed.find((color) => color.now != null && sameTarget(color.now, target));
    if (known) return known;
    // A name another color was renamed away from is a new color if it comes back.
    const claimed = followed.some((color) => color.inFile != null && sameTarget(color.inFile, target));
    const inFile = !claimed && readValue(copy.diskText, target) != null ? target : null;
    const color = { inFile, added: false, now: target, value: null, lastEdit: -1 };
    followed.push(color);
    return color;
  };
  editsOf(copy).forEach((edit, index) => {
    const color = follow(edit.target);
    color.lastEdit = index;
    if (edit.action === "add") color.added = true;
    if (edit.action === "set" || edit.action === "add") color.value = edit.value;
    else if (edit.action === "rename") color.now = renamedTarget(edit.target, edit.name);
    else color.now = null;
  });

  const changes: { change: Change; lastEdit: number }[] = [];
  for (const { inFile, added, now, value, lastEdit } of followed) {
    const push = (change: Change) => changes.push({ change, lastEdit });
    if (inFile == null) {
      if (added && now != null && value != null) push({ action: "set", target: now, from: null, to: value });
      continue;
    }
    const from = readValue(copy.diskText, inFile)!;
    if (now == null) {
      push({ action: "remove", target: inFile as ConstantTarget, from });
      continue;
    }
    if (!sameTarget(now, inFile)) push({ action: "rename", target: inFile as ConstantTarget, to: now as ConstantTarget });
    if (value != null && value !== from) push({ action: "set", target: now, from, to: value });
  }
  return changes.sort((a, b) => a.lastEdit - b.lastEdit).map(({ change }) => change);
}
