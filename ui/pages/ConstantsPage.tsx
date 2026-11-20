import { Fragment, useState } from "react";
import { colorFromOklab, formatAuthored } from "../../src/color-math.js";
import { randomColor } from "../../src/palette-roll.js";
import type { SnapshotConstant } from "../../src/snapshot.js";
import { CONSTANT_COLUMNS, constantAnchor, ConstantRow } from "../ConstantRow.js";
import { AddRow, openNameOf } from "../EntryRow.js";
import { colorNameOf } from "../names.js";
import { useTrying } from "../preview.js";
import { Link, useScrollToHash } from "../router.js";
import { keyFor, UNNAMED } from "./PalettePage.js";

const groupOf = (path: string) => path.split(".").slice(0, -1).join(".");

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
            {CONSTANT_COLUMNS.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loose.map((constant) => (
            <ConstantRow key={constant.path} constant={constant} constants={constants} named={named} siblings={loose} onPalettePage={false} targeted={constantAnchor(constant.path) === hash} />
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
                  <ConstantRow key={constant.path} constant={constant} constants={constants} named={named} siblings={null} onPalettePage={false} targeted={constantAnchor(constant.path) === hash} />
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}
