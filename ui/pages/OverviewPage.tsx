import type { CSSProperties } from "react";
import type { Snapshot, SnapshotConstant } from "../../src/snapshot.js";
import { ColorTip } from "../ColorTip.js";
import { paintCss } from "../paint.js";
import { Link } from "../router.js";
import { Strip } from "../Strip.js";
import { constantAnchor } from "./ConstantsPage.js";

export function OverviewPage({ snapshot }: { snapshot: Snapshot }) {
  const domains = [...new Set(snapshot.roles.map((role) => role.domain))];
  return (
    <>
      <h1>Colors</h1>
      <p className="sub">Modes: {snapshot.modes.join(", ")}</p>
      {snapshot.warnings.length > 0 && (
        <div className="warn">
          <strong>Warnings</strong>
          <ul className="plain">
            {snapshot.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {snapshot.systems.map((system) => (
        <section key={system.system}>
          <h2>
            <Link to={{ page: "system", name: system.system }}>{system.system}</Link>{" "}
            <span className="muted">
              → {system.cssName} · {system.algorithm}
            </span>
          </h2>
          <Strip system={system} />
        </section>
      ))}
      {snapshot.constants.length > 0 && (
        <>
          <h2>
            <Link to={{ page: "constants" }}>Palette</Link>{" "}
            <span className="muted">{snapshot.constants.length}</span>
          </h2>
          {constantGroups(snapshot.constants).map(({ group, constants }) => (
            <div className="strip-wrap" key={group ?? ""} style={{ "--cells": constants.length } as CSSProperties}>
              {group != null && <div className="strip-caption">{group}</div>}
              <div className="strip">
                {constants.map((constant) => (
                  <ColorTip key={constant.path} color={constant.color}>
                    <Link to={{ page: "constants" }} hash={constantAnchor(constant.path)} aria-label={constant.path}>
                      <span className="strip-fill" style={{ background: paintCss(constant.color) }} />
                    </Link>
                  </ColorTip>
                ))}
              </div>
              <div className="strip-labels">
                {constants.map((constant) => (
                  <span key={constant.path}>{constant.path.slice(constant.path.lastIndexOf(".") + 1)}</span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      <h2>Role domains</h2>
      <ul className="plain">
        {domains.map((domain) => (
          <li key={domain}>
            <Link to={{ page: "domain", name: domain }}>
              <code>{domain}</code>
            </Link>{" "}
            <span className="muted">
              {snapshot.roles.filter((role) => role.domain === domain).length} roles
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Palette colors by group, the ungrouped ones first, each group in the order written. */
function constantGroups(constants: SnapshotConstant[]): { group: string | null; constants: SnapshotConstant[] }[] {
  const groups: { group: string | null; constants: SnapshotConstant[] }[] = [];
  for (const constant of constants) {
    const cut = constant.path.lastIndexOf(".");
    const group = cut === -1 ? null : constant.path.slice(0, cut);
    let holder = groups.find((candidate) => candidate.group === group);
    if (!holder) groups.push((holder = { group, constants: [] }));
    holder.constants.push(constant);
  }
  return groups.sort((a, b) => Number(a.group != null) - Number(b.group != null));
}
