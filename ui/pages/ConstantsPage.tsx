import { Fragment } from "react";
import type { SnapshotConstant } from "../../src/snapshot.js";
import { ColorChip } from "../ColorChip.js";
import { Link, useScrollToHash } from "../router.js";
import { UsedBy } from "../UsedBy.js";

export function constantAnchor(path: string): string {
  return `c-${path.replace(/\./g, "_")}`;
}

export function ConstantsPage({ constants }: { constants: SnapshotConstant[] }) {
  const hash = useScrollToHash();
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
          {constants.map((constant) => {
            const anchor = constantAnchor(constant.path);
            return (
              <tr key={constant.path} id={anchor} className={anchor === hash ? "target" : undefined}>
                <td>
                  <code>{constant.path}</code>
                </td>
                <td>
                  {constant.emitted ? (
                    <code>--color-{constant.cssName}</code>
                  ) : (
                    <span className="muted">nothing — its group is an input</span>
                  )}
                </td>
                <td>
                  <ColorChip color={constant.color} label={constant.written} edit={{ kind: "constant", path: constant.path }} />
                </td>
                <td>
                  {constant.usedBy.length > 0 || constant.paramOf.length > 0 ? (
                    <>
                      <UsedBy uses={constant.usedBy} />
                      {constant.usedBy.length > 0 && constant.paramOf.length > 0 && ", "}
                      <ParamOf params={constant.paramOf} />
                    </>
                  ) : (
                    <span className="muted">
                      {constant.emitted ? "nothing — it emits, but no role points at it" : "nothing"}
                    </span>
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
