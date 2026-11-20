import { Fragment } from "react";
import type { ConstantTarget } from "../src/edit.js";
import type { SnapshotConstant } from "../src/snapshot.js";
import { ColorChip } from "./ColorChip.js";
import { rolePath } from "../src/selector.js";
import { copyName, EntryDuplicate, EntryGrip, EntryName, EntryRemove, entryRowProps, groupOf, nameOf, openNameOf, pathProblem } from "./EntryRow.js";
import { Hint } from "./Hint.js";
import { LockIcon } from "./LockIcon.js";
import { useTrying } from "./preview.js";
import { Link } from "./router.js";
import { UsedBy } from "./UsedBy.js";

export function constantAnchor(path: string): string {
  return `c-${path.replace(/\./g, "_")}`;
}

export const CONSTANT_COLUMNS = ["Path", "Emits", "Value", "Used by"];

/** The keys a group of palette colors keeps for itself, which no color in it can be named. */
export const RESERVED = ["alias", "emit", "description"];

/** A palette color's row, the same wherever palette colors are listed. */
export function ConstantRow({
  constant,
  constants,
  named,
  siblings,
  onPalettePage,
  lock = null,
  targeted = false,
}: {
  constant: SnapshotConstant;
  constants: SnapshotConstant[];
  /** Every other name a ref can start with: the systems and the role groups. */
  named: string[];
  /** The colors written beside it, its own among them, when the row can be moved, copied and removed here; null when it cannot. */
  siblings: SnapshotConstant[] | null;
  /** The page is the color's own palette's: the row shows the last part of its path, and its last color takes the palette with it. */
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
          <EntryName
            keys={[constant.path]}
            path={constant.path}
            shown={onPalettePage ? name : constant.path}
            problemOf={(path) => {
              const first = path.split(".")[0];
              if (RESERVED.includes(nameOf(path))) return `${nameOf(path)} is a word a group keeps for itself.`;
              if (first !== constant.path.split(".")[0] && named.includes(first)) return `${first} is already written.`;
              return pathProblem(path, constants.filter((other) => other !== constant).map((other) => other.path));
            }}
            onRepath={(path) => {
              if (groupOf(path) === group) commit({ action: "rename", target, name: nameOf(path) });
              else commit({ action: "place", target, path });
            }}
          />
          {siblings && (
            <span className="entry-actions">
              <EntryDuplicate
                label={constant.path}
                onDuplicate={() => {
                  const copy = copyName(name, [...RESERVED, ...siblings.map((other) => nameOf(other.path)), ...(group === "" ? named : [])]);
                  const path = group === "" ? copy : `${group}.${copy}`;
                  openNameOf(path);
                  commit({ action: "add", target: { kind: "constant", path }, value: constant.written, after: name });
                }}
              />
              <EntryRemove
                label={constant.path}
                users={[
                  ...new Set([
                    ...constant.usedBy.map(rolePath),
                    ...constant.paramOf.map(({ system, param }) => `${system} ${param}`),
                  ]),
                ]}
                stays={lock?.locked ? "Unlock to delete" : null}
                hint={lastOfPalette ? "Delete, and the palette with it" : "Delete"}
                onRemove={() => commit({ action: "remove", target })}
              />
              {lock && (
                <Hint text={lock.locked ? "Unlock" : "Lock"}>
                  <button
                    type="button"
                    className="entry-action entry-lock"
                    aria-label={lock.locked ? `Unlock ${constant.path}` : `Lock ${constant.path}`}
                    aria-pressed={lock.locked}
                    onClick={lock.onToggle}
                  >
                    <LockIcon locked={lock.locked} />
                  </button>
                </Hint>
              )}
            </span>
          )}
        </div>
      </td>
      <td>{constant.emitted ? <code>--color-{constant.cssName}</code> : <span className="muted">Not emitted</span>}</td>
      <td>
        <ColorChip color={constant.color} label={constant.written} edit={target} onUnlock={lock?.locked ? lock.onToggle : undefined} />
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
