import { Fragment, type ReactNode } from "react";
import type { ConstantTarget } from "../src/edit.js";
import type { SnapshotConstant } from "../src/snapshot.js";
import { NO_LOCK, NotAColor, paletteVariable, type PaletteRow } from "./PaletteEntries.js";
import { isGradient } from "./paint.js";
import { ColorChip } from "./ColorChip.js";
import { rolePath } from "../src/selector.js";
import { ControlsCell, ControlsHead, copyName, EntryDuplicate, EntryGrip, EntryName, EntryRemove, entryRowProps, groupOf, nameOf, openNameOf, pathProblem } from "./EntryRow.js";
import { Hint } from "./Hint.js";
import { LockIcon } from "./LockIcon.js";
import { useTrying } from "./preview.js";
import { Link } from "./router.js";
import { UsedBy } from "./UsedBy.js";

export function constantAnchor(path: string): string {
  return `c-${path.replace(/\./g, "_")}`;
}

export const CONSTANT_COLUMNS = ["Path", "Emits", "Value", "Used by"];

/** The palette table's head: the controls column sits beside the name's. */
export function ConstantsHead() {
  return (
    <thead>
      <tr>
        <th>{CONSTANT_COLUMNS[0]}</th>
        <ControlsHead />
        {CONSTANT_COLUMNS.slice(1).map((column) => (
          <th key={column}>{column}</th>
        ))}
      </tr>
    </thead>
  );
}

/** Every column of the palette table, the controls among them. */
export const CONSTANT_COLUMN_COUNT = CONSTANT_COLUMNS.length + 1;

/** The keys a group of palette colors keeps for itself, which no color in it can be named. */
export const RESERVED = ["alias", "emit", "description"];

/** A palette entry's row, the same wherever the palette is listed, for a color and for a gradient written among them. */
export function ConstantRow({
  constant,
  paths,
  named,
  siblings,
  onPalettePage,
  lock = null,
  targeted = false,
}: {
  constant: PaletteRow;
  /** Every path written in the palette, its own among them. */
  paths: string[];
  /** Every other name a ref can start with: the systems and the role groups. */
  named: string[];
  /** The entries written beside it, its own among them, when the row can be moved, copied and removed here; null when it cannot. */
  siblings: PaletteRow[] | null;
  /** The page is the color's own palette's: its last color takes the palette with it. */
  onPalettePage: boolean;
  /** The palette page's lock on the color, where it has one. */
  lock?: { locked: boolean; onToggle: () => void } | null;
  targeted?: boolean;
}) {
  const { commit } = useTrying();
  const target: ConstantTarget = { kind: "constant", path: constant.path };
  const group = groupOf(constant.path);
  const name = nameOf(constant.path);
  const used = constant.usedBy.length > 0 || constant.paramOf.length > 0;
  const lastOfPalette = onPalettePage && siblings?.length === 1;
  /** A gradient is never rolled, so its lock is shown and cannot be turned. */
  const fixed = isGradient(constant.paint);
  return (
    <tr id={constantAnchor(constant.path)} className={targeted ? "target" : undefined} {...(siblings ? entryRowProps(group, name) : {})}>
      <td>
        <div className="entry-head">
          {siblings && (
            <EntryGrip
              label={constant.path}
              group={group}
              name={name}
              siblings={siblings.map((other) => nameOf(other.path))}
              onMove={(after) => commit({ action: "move", target, after })}
            />
          )}
          <ConstantName path={constant.path} paths={paths} named={named} after={isGradient(constant.paint) && onPalettePage && <NotAColor />} />
        </div>
      </td>
      <ControlsCell>
        {siblings && (
          <>
            <EntryRemove
              label={constant.path}
              users={constantUsers(constant)}
              stays={lock?.locked && !fixed ? "Unlock to delete" : null}
              hint={lastOfPalette ? "Delete, and the palette with it" : "Delete"}
              onRemove={() => commit({ action: "remove", target })}
            />
            <EntryDuplicate
              label={constant.path}
              onDuplicate={() => {
                const copy = copyName(name, [...RESERVED, ...siblings.map((other) => nameOf(other.path)), ...(group === "" ? named : [])]);
                const path = group === "" ? copy : `${group}.${copy}`;
                openNameOf(path);
                commit({ action: "add", target: { kind: "constant", path }, value: constant.written, after: name });
              }}
            />
          </>
        )}
        {siblings && lock && (
          <Hint text={fixed ? NO_LOCK : lock.locked ? "Unlock" : "Lock"}>
            <button
              type="button"
              className="entry-action entry-lock"
              aria-label={fixed ? `${constant.path} has no lock` : lock.locked ? `Unlock ${constant.path}` : `Lock ${constant.path}`}
              aria-pressed={fixed ? undefined : lock.locked}
              // Not `disabled`: a disabled button gets no pointer events, so its hint would never show.
              aria-disabled={fixed}
              onClick={fixed ? undefined : lock.onToggle}
            >
              <LockIcon locked={fixed || lock.locked} />
            </button>
          </Hint>
        )}
      </ControlsCell>
      <td>{constant.emitted ? <code>{paletteVariable(constant)}</code> : <span className="muted">Not emitted</span>}</td>
      <td>
        <ColorChip color={constant.paint} label={constant.written} edit={target} onUnlock={lock?.locked && !fixed ? lock.onToggle : undefined} />
      </td>
      <td>
        <UsedBy uses={constant.usedBy} />
        {constant.usedBy.length > 0 && constant.paramOf.length > 0 && ", "}
        <ParamOf params={constant.paramOf} />
        {constant.emitted ? (
          <span className="muted">
            {used && ", "}
            emit
          </span>
        ) : (
          !used && <span className="muted">—</span>
        )}
      </td>
    </tr>
  );
}

/** What points at a palette entry, each by name: the roles that use it and the system params that name it. */
export function constantUsers(constant: Pick<SnapshotConstant, "usedBy" | "paramOf">): string[] {
  return [...new Set([...constant.usedBy.map(rolePath), ...constant.paramOf.map(({ system, param }) => `${system} ${param}`)])];
}

/**
 * A palette entry's name, the last part of its path, which a double click
 * retypes: a new last part renames it, a new group moves it there.
 */
export function ConstantName({
  path: current,
  paths,
  named,
  after,
  onRepath,
}: {
  path: string;
  /** Every path written in the palette, its own among them. */
  paths: string[];
  /** Every other name a ref can start with: the systems and the role groups. */
  named: string[];
  /** Shown inline after the name. */
  after?: ReactNode;
  /** Told the path it now has, after the edit is made. */
  onRepath?: (path: string) => void;
}) {
  const { commit } = useTrying();
  const target: ConstantTarget = { kind: "constant", path: current };
  return (
    <EntryName
      keys={[current]}
      path={current}
      shown={nameOf(current)}
      after={after}
      problemOf={(path) => {
        const first = path.split(".")[0];
        if (RESERVED.includes(nameOf(path))) return `${nameOf(path)} is a word a group keeps for itself.`;
        if (first !== current.split(".")[0] && named.includes(first)) return `${first} is already written.`;
        return pathProblem(path, paths.filter((other) => other !== current));
      }}
      onRepath={(path) => {
        if (groupOf(path) === groupOf(current)) commit({ action: "rename", target, name: nameOf(path) });
        else commit({ action: "place", target, path });
        onRepath?.(path);
      }}
    />
  );
}

/** The systems whose params name a color, linked to each system's page. */
function ParamOf({ params }: { params: SnapshotConstant["paramOf"] }) {
  return params.map(({ system, param }, index) => (
    <Fragment key={`${system} ${param}`}>
      {index > 0 && ", "}
      <Link to={{ page: "system", name: system }}>
        <code>{system}</code>
      </Link>
      <span className="muted"> {param}</span>
    </Fragment>
  ));
}
