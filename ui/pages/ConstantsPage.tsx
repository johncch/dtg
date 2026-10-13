import type { SnapshotConstant } from "../../src/snapshot.js";
import { ColorChip } from "../ColorChip.js";
import { useScrollToHash } from "../router.js";
import { UsedBy } from "../UsedBy.js";

export function constantAnchor(path: string): string {
  return `c-${path.replace(/\./g, "_")}`;
}

export function ConstantsPage({ constants }: { constants: SnapshotConstant[] }) {
  const hash = useScrollToHash();
  return (
    <>
      <h1>Constants</h1>
      <p className="desc">
        Flat colors with no recipe behind them. A role points at one by path; <code>transparent(name 70)</code> takes
        one at an alpha. Unlike a system step, a constant emits whether or not anything demands it.
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
          {constants.map((constant) => {
            const anchor = constantAnchor(constant.path);
            return (
              <tr key={constant.path} id={anchor} className={anchor === hash ? "target" : undefined}>
                <td>
                  <code>{constant.path}</code>
                </td>
                <td>
                  <code>--color-{constant.cssName}</code>
                </td>
                <td>
                  <ColorChip color={constant.color} edit={{ kind: "constant", path: constant.path }} />
                </td>
                <td>
                  {constant.usedBy.length > 0 ? (
                    <UsedBy uses={constant.usedBy} />
                  ) : (
                    <span className="muted">nothing — it emits, but no role points at it</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
