import { Fragment, useState } from "react";
import { colorFromOklab, formatAuthored } from "../../src/engine/color-math.js";
import { randomColor } from "../../src/engine/palette-roll.js";
import type { SnapshotConstant, SnapshotGradient } from "../../src/engine/snapshot.js";
import { paletteRows } from "../PaletteEntries.js";
import { CONSTANT_COLUMN_COUNT, ConstantsHead, constantAnchor, ConstantRow, RESERVED } from "../ConstantRow.js";
import { AddRow, groupOf, openNameOf } from "../EntryRow.js";
import { colorNameOf } from "../names.js";
import { useTrying } from "../preview.js";
import { Link, useScrollToHash } from "../router.js";
import type { Change } from "../../src/engine/working-copy.js";
import { addedSinceSave, keyFor, newColorFor, palettesOf, storedRollStyle, UNNAMED, type Palette } from "./PalettePage.js";

/**
 * Closes a group's colors, or those in no group: adds one named after itself
 * and opens its name. In a group it is the color the group's own page would
 * add, fitting the others; in no group, which is not a palette, a random one.
 */
function NewConstantRow({ group, taken, palette, changes }: { group: string; taken: string[]; palette: Palette | null; changes: Change[] }) {
  const { commit } = useTrying();
  const [busy, setBusy] = useState(false);
  return (
    <AddRow
      label="New color"
      columns={CONSTANT_COLUMN_COUNT}
      busy={busy}
      onAdd={async () => {
        setBusy(true);
        const lab = palette ? newColorFor(palette, (path) => !addedSinceSave(changes, path), storedRollStyle(), null) : randomColor();
        const key = keyFor((await colorNameOf(colorFromOklab(lab))) ?? UNNAMED, taken);
        const path = group === "" ? key : `${group}.${key}`;
        openNameOf(path);
        commit({ action: "add", target: { kind: "constant", path }, value: formatAuthored(lab) });
        setBusy(false);
      }}
    />
  );
}

/**
 * Every palette color in one table, so the columns line up: first the colors
 * in no group, then each group's under its name.
 */
export function ConstantsPage({
  constants,
  gradients,
  order,
  named,
  changes,
}: {
  constants: SnapshotConstant[];
  gradients: SnapshotGradient[];
  /** Every palette entry's path, in the order written. */
  order: string[];
  /** Every other name a ref can start with: the systems and the role groups. */
  named: string[];
  changes: Change[];
}) {
  const hash = useScrollToHash();
  const palettes = palettesOf(constants, gradients);
  const loose = paletteRows("", constants, gradients, order);
  const paths = [...constants, ...gradients].map((entry) => entry.path);
  const groups = [...new Set(paths.map(groupOf).filter((group) => group !== ""))].sort((a, b) => order.findIndex((path) => groupOf(path) === a) - order.findIndex((path) => groupOf(path) === b));
  return (
    <>
      <h1>Palette</h1>
      <table className="palette-table">
        <ConstantsHead />
        <tbody>
          {loose.map((row) => (
            <ConstantRow key={row.path} constant={row} paths={paths} named={named} siblings={loose} onPalettePage={false} targeted={constantAnchor(row.path) === hash} />
          ))}
          <NewConstantRow group="" palette={null} changes={changes} taken={[...RESERVED, ...constants.map((constant) => constant.path.split(".")[0]), ...named]} />
          {groups.map((group) => {
            const rows = paletteRows(group, constants, gradients, order);
            return (
              <Fragment key={group}>
                <tr className="group-row">
                  <td colSpan={CONSTANT_COLUMN_COUNT}>
                    <Link to={{ page: "palette", name: group }}>{group}</Link>
                  </td>
                </tr>
                {rows.map((row) => (
                  <ConstantRow key={row.path} constant={row} paths={paths} named={named} siblings={rows} onPalettePage={false} targeted={constantAnchor(row.path) === hash} />
                ))}
                <NewConstantRow group={group} palette={palettes.find((palette) => palette.group === group) ?? null} changes={changes} taken={[...RESERVED, ...rows.map((row) => row.path.slice(group.length + 1))]} />
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
