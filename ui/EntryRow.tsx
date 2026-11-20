import { Copy, GripVertical, Plus } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { Hint } from "./Hint.js";
import { EDITABLE } from "./mode.js";
import { TrashIcon } from "./TrashIcon.js";

/**
 * What a table of named entries — roles, palette colors — is edited with:
 * a name to retype, a handle to drag the row by, a button to remove it, and
 * the row that adds one. Each knows nothing of what the entry is; the page
 * says which edit a gesture commits.
 */

export const ENTRY_NAME = /^[A-Za-z][\w-]*$/;
export const ENTRY_NAME_RULE = "Letters, digits, - and _, starting with a letter.";

export const groupOf = (path: string) => path.split(".").slice(0, -1).join(".");
export const nameOf = (path: string) => path.split(".").at(-1)!;

/** The entry just added, whose row opens its name for typing once the working copy has it. */
let naming: string | null = null;

export function openNameOf(key: string): void {
  naming = key;
}

/**
 * A name that a double click opens for retyping, kept on Enter or on leaving
 * the field. The field lies over the name's place in the row at a width of
 * its own, so opening it moves nothing, and a long name scrolls inside it.
 */
function Retyped({
  keys,
  shown,
  written,
  selectFrom = 0,
  problemOf,
  onKeep,
}: {
  /** What `openNameOf` can call this row by. */
  keys: string[];
  /** What the row shows. */
  shown: string;
  /** What the field opens holding. */
  written: string;
  /** Where in `written` the selection starts when the field opens; it runs to the end. */
  selectFrom?: number;
  problemOf: (typed: string) => string | null;
  onKeep: (typed: string) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (naming == null || !keys.includes(naming)) return;
    naming = null;
    setTyped(written);
  }, [keys.join("\n")]);

  if (!EDITABLE) return <code>{shown}</code>;
  if (typed == null) {
    return (
      <span className="entry-name">
        <code title="Double-click to rename" onDoubleClick={() => setTyped(written)}>
          {shown}
        </code>
      </span>
    );
  }
  const problem = typed === written ? null : problemOf(typed);
  const keep = () => {
    if (problem) return false;
    if (typed !== written) onKeep(typed);
    setTyped(null);
    return true;
  };
  return (
    <span className="entry-name entry-name-editing">
      <code className="entry-name-held">{shown}</code>
      <input
        type="text"
        className="ref-input entry-name-input"
        aria-label={`Name of ${shown}`}
        value={typed}
        spellCheck={false}
        autoComplete="off"
        data-1p-ignore
        autoFocus
        onFocus={(event) => event.target.setSelectionRange(selectFrom, event.target.value.length)}
        onChange={(event) => setTyped(event.target.value.trim())}
        onBlur={() => keep() || setTyped(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") keep();
          if (event.key === "Escape") setTyped(null);
        }}
      />
      {problem && <span className="ref-error ref-problem entry-name-problem">{problem}</span>}
    </span>
  );
}

/**
 * An entry's name, retyped as its whole dotted path: changing the last part
 * renames it, and changing what comes before moves it to that group. The
 * field opens with the last part selected, so typing renames.
 */
export function EntryName({
  keys,
  path,
  shown,
  problemOf,
  onRepath,
}: {
  keys: string[];
  /** The entry's dotted path, as refs write it. */
  path: string;
  /** What the row shows: the path, or its last part under a group's heading. */
  shown: string;
  /** Why the entry cannot be at a path, for one whose every part is a name. */
  problemOf: (path: string) => string | null;
  onRepath: (path: string) => void;
}) {
  return (
    <Retyped
      keys={keys}
      shown={shown}
      written={path}
      selectFrom={path.lastIndexOf(".") + 1}
      problemOf={(typed) => (typed.split(".").every((part) => ENTRY_NAME.test(part)) ? problemOf(typed) : `${ENTRY_NAME_RULE} Dots separate groups.`)}
      onKeep={onRepath}
    />
  );
}

/** A group's own name, the last part of its path: retyping it renames the group where it is. */
export function GroupName({ path, taken, onRename }: { path: string; taken: string[]; onRename: (name: string) => void }) {
  const name = nameOf(path);
  return (
    <Retyped
      keys={[]}
      shown={path}
      written={name}
      problemOf={(typed) => (!ENTRY_NAME.test(typed) ? ENTRY_NAME_RULE : taken.includes(typed) ? `${typed} is already written.` : null)}
      onKeep={onRename}
    />
  );
}

/**
 * Why an entry cannot be placed at `path` among `others`, the paths already
 * written beside it: one of them has the path, or is where a group would
 * have to be, or `path` is a group that holds some of them.
 */
export function pathProblem(path: string, others: string[]): string | null {
  if (others.includes(path)) return `${path} is already written.`;
  const parts = path.split(".");
  const blocking = parts.map((_, depth) => parts.slice(0, depth).join(".")).find((group) => group !== "" && others.includes(group));
  if (blocking) return `${blocking} is not a group.`;
  if (others.some((other) => other.startsWith(`${path}.`))) return `${path} is a group.`;
  return null;
}

/** Why an entry that `users` point at cannot go. */
export function usedByRefusal(users: string[]): string {
  const shown = users.length > 3 ? `${users.slice(0, 3).join(", ")} and ${users.length - 3} more` : users.join(", ");
  return `Used by ${shown}. Point ${users.length === 1 ? "it" : "them"} elsewhere first.`;
}

/** Removes an entry, unless something still uses it or the page gives another reason it must stay. */
export function EntryRemove({
  label,
  users,
  stays = null,
  hint = "Delete",
  onRemove,
}: {
  label: string;
  /** What points at the entry, each by name. */
  users: string[];
  /** Why it cannot go, when it is not for being used. */
  stays?: string | null;
  hint?: string;
  onRemove: () => void;
}) {
  if (!EDITABLE) return null;
  const refusal = users.length > 0 ? usedByRefusal(users) : stays;
  return (
    <Hint text={refusal ?? hint}>
      <button
        type="button"
        className="entry-action entry-remove"
        aria-label={`Remove ${label}`}
        // Not `disabled`: a disabled button gets no pointer events, so its hint would never show.
        aria-disabled={refusal != null}
        onClick={() => {
          if (refusal == null) onRemove();
        }}
      >
        <TrashIcon />
      </button>
    </Hint>
  );
}

/** `name` numbered to the next one `taken` does not have: `paper` → `paper-2`, `paper-2` → `paper-3`. */
export function copyName(name: string, taken: string[]): string {
  const numbered = /^(.*)-(\d+)$/.exec(name);
  const stem = numbered ? numbered[1] : name;
  let count = numbered ? Number(numbered[2]) + 1 : 2;
  while (taken.includes(`${stem}-${count}`)) count += 1;
  return `${stem}-${count}`;
}

/** Adds a copy of an entry beneath it; the page says what a copy holds. */
export function EntryDuplicate({ label, onDuplicate }: { label: string; onDuplicate: () => void }) {
  if (!EDITABLE) return null;
  return (
    <Hint text="Duplicate">
      <button type="button" className="entry-action" aria-label={`Duplicate ${label}`} onClick={onDuplicate}>
        <Copy size={12} aria-hidden />
      </button>
    </Hint>
  );
}

/** What a row carries for `EntryGrip` to find it and the rows it can change places with. */
export function entryRowProps(group: string, name: string): { "data-entry": string; "data-entry-group": string } {
  return { "data-entry": name, "data-entry-group": group };
}

/**
 * A handle that drags an entry to another place among its siblings. The rows
 * are marked where it would land; `onMove` is told when it is dropped.
 */
export function EntryGrip({
  label,
  group,
  name,
  siblings,
  onMove,
}: {
  label: string;
  /** The `entryRowProps` group of the rows it moves among. */
  group: string;
  name: string;
  /** Every name in the group, its own among them, in order. */
  siblings: string[];
  /** `after` is the sibling it now follows, or null when it is first. */
  onMove: (after: string | null) => void;
}) {
  if (!EDITABLE || siblings.length < 2) return null;
  return (
    <Hint text="Drag to reorder" side="left">
      <button
        type="button"
        className="entry-grip"
        aria-label={`Move ${label}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const table = event.currentTarget.closest("tbody");
          if (!table) return;
          const rows = [...table.querySelectorAll<HTMLElement>("tr[data-entry]")].filter((row) => row.dataset.entryGroup === group);
          const own = rows.find((row) => row.dataset.entry === name);
          const others = rows.filter((row) => row !== own);
          const from = siblings.indexOf(name);
          let slot = from;
          const mark = (pointerY: number) => {
            for (const row of rows) delete row.dataset.drop;
            const below = others.findIndex((row) => {
              const box = row.getBoundingClientRect();
              return pointerY < box.top + box.height / 2;
            });
            slot = below === -1 ? others.length : below;
            if (slot === from) return;
            if (below === -1) others.at(-1)!.dataset.drop = "after";
            else others[below].dataset.drop = "before";
          };
          own?.setAttribute("data-dragged", "");
          const onPointerMove = (move: PointerEvent) => mark(move.clientY);
          const onEnd = (end: PointerEvent) => {
            removeEventListener("pointermove", onPointerMove);
            removeEventListener("pointerup", onEnd);
            removeEventListener("pointercancel", onEnd);
            for (const row of rows) delete row.dataset.drop;
            own?.removeAttribute("data-dragged");
            if (end.type !== "pointerup" || slot === from) return;
            const rest = siblings.filter((other) => other !== name);
            onMove(slot === 0 ? null : rest[slot - 1]);
          };
          addEventListener("pointermove", onPointerMove);
          addEventListener("pointerup", onEnd);
          addEventListener("pointercancel", onEnd);
        }}
      >
        <GripVertical size={12} aria-hidden />
      </button>
    </Hint>
  );
}

/** Closes a table's rows, or one group's: a button that adds an entry after them. */
export function AddRow({ label, columns, busy = false, onAdd }: { label: string; columns: number; busy?: boolean; onAdd: () => void }) {
  if (!EDITABLE) return null;
  return (
    <tr className="entry-add">
      <td colSpan={columns}>
        <button type="button" disabled={busy} onClick={onAdd}>
          <Plus size={14} aria-hidden />
          {label}
        </button>
      </td>
    </tr>
  );
}
