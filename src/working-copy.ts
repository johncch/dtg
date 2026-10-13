import { applyEdits, readValue, type Edit, type EditTarget } from "./edit.js";

/**
 * The definition as it is on disk, the edits made since that are not yet
 * written to it, and the edits taken back that can still be redone.
 * Everything else — the text the app is drawn from, what counts as a change —
 * is worked out from these, so they cannot disagree.
 *
 * `undone` is a stack: its last entry is the next one redo brings back.
 */
export type WorkingCopy = { diskText: string; edits: Edit[]; undone: Edit[] };

export function openFile(diskText: string): WorkingCopy {
  return { diskText, edits: [], undone: [] };
}

/** A new edit; whatever could have been redone is gone, as in any editor. */
export function withEdit(copy: WorkingCopy, edit: Edit): WorkingCopy {
  return { ...copy, edits: [...copy.edits, edit], undone: [] };
}

export function undo(copy: WorkingCopy): WorkingCopy {
  const last = copy.edits.at(-1);
  if (!last) return copy;
  return { ...copy, edits: copy.edits.slice(0, -1), undone: [...copy.undone, last] };
}

export function redo(copy: WorkingCopy): WorkingCopy {
  const next = copy.undone.at(-1);
  if (!next) return copy;
  return { ...copy, edits: [...copy.edits, next], undone: copy.undone.slice(0, -1) };
}

/**
 * Drop every unsaved edit. It is undo all the way down rather than a wipe,
 * so redo brings the edits back in the order they were made.
 */
export function discard(copy: WorkingCopy): WorkingCopy {
  return { ...copy, edits: [], undone: [...copy.undone, ...[...copy.edits].reverse()] };
}

/** One color whose working value differs from the file's. */
export type Change = { target: EditTarget; from: string; to: string };

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
  for (const edit of copy.edits) {
    try {
      text = applyEdits(text, [edit]);
    } catch {
      dropped.push(edit);
    }
  }
  return { text, dropped };
}

/**
 * What saving would change, one entry per color: the last value given to it,
 * against what the file has. A color edited back to the file's value is not
 * a change, however many edits it took to get there.
 */
export function changesOf(copy: WorkingCopy): Change[] {
  const changes: Change[] = [];
  copy.edits.forEach((edit, index) => {
    const later = copy.edits
      .slice(index + 1)
      .some((other) => sameTarget(other.target, edit.target));
    if (later) return;
    const from = readValue(copy.diskText, edit.target);
    if (from != null && from !== edit.value) {
      changes.push({ target: edit.target, from, to: edit.value });
    }
  });
  return changes;
}
