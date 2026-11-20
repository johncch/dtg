import { Fragment, useState } from "react";
import { colorFromOklab, formatAuthored } from "../../src/color-math.js";
import type { ConstantTarget } from "../../src/edit.js";
import { randomColor } from "../../src/palette-roll.js";
import type { SnapshotConstant } from "../../src/snapshot.js";
import { ColorChip } from "../ColorChip.js";
import { AddRow, EntryGrip, EntryName, EntryRemove, entryRowProps, openNameOf } from "../EntryRow.js";
import { colorNameOf } from "../names.js";
import { useTrying } from "../preview.js";
import { Link, useScrollToHash } from "../router.js";
import { UsedBy } from "../UsedBy.js";
import { keyFor, UNNAMED } from "./PalettePage.js";

export function constantAnchor(path: string): string {
  return `c-${path.replace(/\./g, "_")}`;
}

const targetOf = (constant: SnapshotConstant): ConstantTarget => ({ kind: "constant", path: constant.path });
const groupOf = (path: string) => path.split(".").slice(0, -1).join(".");
const nameOf = (path: string) => path.split(".").at(-1)!;

/** The rows `EntryGrip` moves among: the colors in no group. */
const LOOSE = "palette";

/** The names a constant at `path` cannot be renamed to: its siblings', and for one in no group whatever else refs can name. */
function takenBeside(path: string, constants: SnapshotConstant[], named: string[]): string[] {
  const group = groupOf(path);
  const prefix = group === "" ? "" : `${group}.`;
  const siblings = constants
    .filter((other) => other.path !== path && other.path.startsWith(prefix))
    .map((other) => other.path.slice(prefix.length).split(".")[0]);
  return ["alias", "emit", "description", ...siblings, ...(group === "" ? named : [])];
}

/** Closes the colors in no group: adds a random one, named after itself, and opens its name. */
function NewConstantRow({ taken }: { taken: string[] }) {
  const { commit } = useTrying();
  const [busy, setBusy] = useState(false);
  return (
    <AddRow
      label="New color"
      columns={4}
      busy={busy}
      onAdd={async () => {
        setBusy(true);
        const lab = randomColor();
        const path = keyFor((await colorNameOf(colorFromOklab(lab))) ?? UNNAMED, taken);
        openNameOf(path);
        commit({ action: "add", target: { kind: "constant", path }, value: formatAuthored(lab) });
        setBusy(false);
      }}
    />
  );
}

/**
 * Every palette color in one table, so the columns line up: first the colors
 * in no group, which are added, reordered and removed here, then each
 * group's under its name, which are on the group's own page.
 */
export function ConstantsPage({
  constants,
  named,
}: {
  constants: SnapshotConstant[];
  /** Every other name a ref can start with: the systems and the role groups. */
  named: string[];
}) {
  const hash = useScrollToHash();
  const loose = constants.filter((constant) => groupOf(constant.path) === "");
  const groups = [...new Set(constants.map((constant) => groupOf(constant.path)).filter((group) => group !== ""))];
  return (
    <>
      <h1>Palette</h1>
      <p className="desc">
        Every color picked by hand, with no recipe behind it. A role points at one by path;{" "}
        <code>transparent(name 70)</code> takes one at an alpha. Unlike a system step, each one emits whether or not
        anything uses it.
      </p>
      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>Emits</th>
            <th>Value</th>
            <th>Used by</th>
          </tr>
        </thead>
        <tbody>
          {loose.map((constant) => (
            <ConstantRow key={constant.path} constant={constant} constants={constants} named={named} loose={loose} targeted={constantAnchor(constant.path) === hash} />
          ))}
          <NewConstantRow taken={takenBeside("", constants, named)} />
          {groups.map((group) => (
            <Fragment key={group}>
              <tr className="group-row">
                <td colSpan={4}>
                  <Link to={{ page: "palette", name: group }}>{group}</Link>
                </td>
              </tr>
              {constants
                .filter((constant) => groupOf(constant.path) === group)
                .map((constant) => (
                  <ConstantRow key={constant.path} constant={constant} constants={constants} named={named} loose={null} targeted={constantAnchor(constant.path) === hash} />
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ConstantRow({
  constant,
  constants,
  named,
  loose,
  targeted,
}: {
  constant: SnapshotConstant;
  constants: SnapshotConstant[];
  named: string[];
  /** The colors in no group when this is one of them, to move among and be removed from; null for a color in a group. */
  loose: SnapshotConstant[] | null;
  targeted: boolean;
}) {
  const { commit } = useTrying();
  const target = targetOf(constant);
  const name = nameOf(constant.path);
  const used = constant.usedBy.length > 0 || constant.paramOf.length > 0;
  return (
    <tr id={constantAnchor(constant.path)} className={targeted ? "target" : undefined} {...(loose ? entryRowProps(LOOSE, name) : {})}>
      <td>
        <div className="entry-head">
          {loose && (
            <EntryGrip
              label={constant.path}
              group={LOOSE}
              name={name}
              siblings={loose.map((other) => other.path)}
              onMove={(after) => commit({ action: "move", target, after })}
            />
          )}
          <EntryName
            keys={[constant.path]}
            name={name}
            label={constant.path}
            taken={takenBeside(constant.path, constants, named)}
            whenTaken={(typed) => `${[...constant.path.split(".").slice(0, -1), typed].join(".")} is already written.`}
            onRename={(typed) => commit({ action: "rename", target, name: typed })}
          />
          {loose && (
            <span className="entry-actions">
              <EntryRemove
                label={constant.path}
                users={[
                  ...new Set([
                    ...constant.usedBy.map((use) => (use.group ? `${use.group}.${use.role}` : use.role)),
                    ...constant.paramOf.map(({ system, param }) => `${system} ${param}`),
                  ]),
                ]}
                onRemove={() => commit({ action: "remove", target })}
              />
            </span>
          )}
        </div>
      </td>
      <td>{constant.emitted ? <code>--color-{constant.cssName}</code> : <span className="muted">Not emitted</span>}</td>
      <td>
        <ColorChip color={constant.color} label={constant.written} edit={target} />
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
