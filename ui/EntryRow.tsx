import { GripVertical, Plus } from "lucide-react";
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

/** The entry just added, whose row opens its name for typing once the working copy has it. */
let naming: string | null = null;

export function openNameOf(key: string): void {
  naming = key;
}

/** An entry's name; in the editor a double click opens it for renaming, kept on Enter or on leaving the field. */
export function EntryName({
  keys,
  name,
  label = name,
  taken,
  whenTaken,
  onRename,
}: {
  /** What `openNameOf` can call this row by. */
  keys: string[];
  /** The part that is retyped. */
  name: string;
  /** What is shown: the name, or the path it ends. */
  label?: string;
  taken: string[];
  whenTaken: (name: string) => string;
  onRename: (name: string) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (naming == null || !keys.includes(naming)) return;
    naming = null;
    setTyped(name);
  }, [keys.join("\n")]);

  if (!EDITABLE) return <code>{label}</code>;
  const before = label.endsWith(name) ? label.slice(0, -name.length) : "";
  if (typed == null) {
    return (
      <code title="Double-click to rename" onDoubleClick={() => setTyped(name)}>
        {before}
        {name}
      </code>
    );
  }
  const problem = !ENTRY_NAME.test(typed) ? ENTRY_NAME_RULE : typed !== name && taken.includes(typed) ? whenTaken(typed) : null;
  const keep = () => {
    if (problem) return false;
    if (typed !== name) onRename(typed);
    setTyped(null);
    return true;
  };
  // The name stays in the row, unseen, holding its place; the field lies over it, so opening it moves nothing.
  return (
    <code>
      {before}
      <span className="entry-name-editing">
        <span className="entry-name-held">{name}</span>
        <input
          type="text"
          className="ref-input entry-name-input"
          aria-label={`Name of ${label}`}
          value={typed}
          style={{ width: `${Math.max(typed.length + 1, 8)}ch` }}
          spellCheck={false}
          autoComplete="off"
          data-1p-ignore
          autoFocus
          onFocus={(event) => event.target.select()}
          onChange={(event) => setTyped(event.target.value.trim())}
          onBlur={() => keep() || setTyped(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") keep();
            if (event.key === "Escape") setTyped(null);
          }}
        />
        {problem && <span className="ref-error system-form-problem entry-name-problem">{problem}</span>}
      </span>
    </code>
  );
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
  const shown = users.length > 3 ? `${users.slice(0, 3).join(", ")} and ${users.length - 3} more` : users.join(", ");
  const refusal = users.length > 0 ? `Used by ${shown}. Point them elsewhere first.` : stays;
  return (
    <Hint text={refusal ?? hint}>
      <button
        type="button"
        className="entry-remove"
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
