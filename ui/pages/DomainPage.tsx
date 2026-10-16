import { Fragment, type ReactNode } from "react";
import type { RefTarget } from "../../src/resolve.js";
import type { Snapshot, SnapshotRole } from "../../src/snapshot.js";
import { isOpaque } from "../../src/color-math.js";
import { ColorTip } from "../ColorTip.js";
import { paintCss } from "../paint.js";
import { Popup } from "../Popup.js";
import { STATIC } from "../mode.js";
import { RefEditor } from "../RefEditor.js";
import { Link, useScrollToHash } from "../router.js";
import { INHERIT } from "../../src/selector.js";
import { stepAnchor } from "../Strip.js";
import { constantAnchor } from "./ConstantsPage.js";

export function DomainPage({ snapshot, domain }: { snapshot: Snapshot; domain: string }) {
  const hash = useScrollToHash(domain);
  const roles = snapshot.roles.filter((role) => role.domain === domain);
  return (
    <>
      <h1>{domain}</h1>
      {snapshot.groupNotes.roles[domain] && <p className="note">{snapshot.groupNotes.roles[domain]}</p>}
      <p className="sub">{roles.length} roles</p>
      <table>
        <thead>
          <tr>
            <th>Role</th>
            {snapshot.modes.map((mode) => (
              <th key={mode}>{mode}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <RoleRow key={role.role} snapshot={snapshot} role={role} id={role.role} targeted={role.role === hash} />
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Every role in the definition, grouped by domain, in one table so the mode columns line up. */
export function RolesPage({ snapshot }: { snapshot: Snapshot }) {
  const domains = [...new Set(snapshot.roles.map((role) => role.domain))];
  return (
    <>
      <h1>Roles</h1>
      <p className="sub">
        {snapshot.roles.length} roles in {domains.length} domains
      </p>
      <table>
        <thead>
          <tr>
            <th>Role</th>
            {snapshot.modes.map((mode) => (
              <th key={mode}>{mode}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {domains.map((domain) => (
            <Fragment key={domain}>
              <tr className="domain-row">
                <td colSpan={snapshot.modes.length + 1}>
                  <Link to={{ page: "domain", name: domain }}>{domain}</Link>
                </td>
              </tr>
              {snapshot.roles
                .filter((role) => role.domain === domain)
                .map((role) => (
                  <RoleRow key={role.role} snapshot={snapshot} role={role} targeted={false} />
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RoleRow({
  snapshot,
  role,
  id,
  targeted,
}: {
  snapshot: Snapshot;
  role: SnapshotRole;
  /** Set where the page is one domain, so a link can land on the row. */
  id?: string;
  targeted: boolean;
}) {
  return (
    <tr id={id} className={targeted ? "target" : undefined}>
      <td>
        <code>{role.role}</code>
        {role.note && <div className="role-note">{role.note}</div>}
      </td>
      {role.perMode.map((entry, index) => {
        const parent = snapshot.modeParents[index];
        const trail = refTrail(snapshot, entry, index);
        const trailText = <code>{trail.join(" → ")}</code>;
        const inheritedNote = entry.inherited && <span className="muted">inherited from {parent}</span>;
        if (STATIC) {
          return (
            <td key={index}>
              <ColorTip
                color={entry.color}
                reference={
                  <>
                    <RefLink snapshot={snapshot} target={entry.target}>
                      {trailText}
                    </RefLink>
                    {inheritedNote}
                  </>
                }
              >
                <span className={entry.inherited ? "chip chip-inherited" : "chip"}>
                  <span className={isOpaque(entry.color) ? "swatch" : "swatch swatch-alpha"}>
                    <span className="swatch-color" style={{ background: paintCss(entry.color) }} />
                  </span>
                  <code>{entry.ref}</code>
                </span>
              </ColorTip>
            </td>
          );
        }
        return (
          <td key={index}>
            <Popup
              title="Edit ref"
              className={entry.inherited ? "chip chip-editable chip-inherited" : "chip chip-editable"}
              label={
                <>
                  <span className={isOpaque(entry.color) ? "swatch" : "swatch swatch-alpha"}>
                    <span className="swatch-color" style={{ background: paintCss(entry.color) }} />
                  </span>
                  <code>{entry.ref}</code>
                </>
              }
              focus={entry.target.kind === "role" && !entry.inherited ? "field" : "panel"}
              wrap={(button, open) => (
                <ColorTip
                  color={entry.color}
                  suppressed={open}
                  reference={
                    <>
                      <RefLink snapshot={snapshot} target={entry.target}>
                        {trailText}
                      </RefLink>
                      {inheritedNote}
                    </>
                  }
                >
                  {button}
                </ColorTip>
              )}
            >
              {(panel) => (
                <RefEditor
                  written={entry.inherited ? INHERIT : entry.ref}
                  target={{
                    kind: "ref",
                    section: role.section,
                    role: [role.domain, role.role].filter(Boolean).join("."),
                    mode: index,
                  }}
                  heading={`${role.role} · ${snapshot.modes[index]}`}
                  inherits={
                    parent == null ? null : { mode: parent, ref: role.perMode[snapshot.modes.indexOf(parent)].ref }
                  }
                  color={entry.color}
                  reference={
                    <>
                      <RefLink snapshot={snapshot} target={entry.target} onFollow={panel.dismiss}>
                        {trailText}
                      </RefLink>
                      {inheritedNote}
                    </>
                  }
                  systems={snapshot.systems}
                  constants={snapshot.constants}
                  panel={panel}
                />
              )}
            </Popup>
          </td>
        );
      })}
    </tr>
  );
}

/** The ref, then each ref it leads to through other roles, down to the step or constant the color comes from. */
function refTrail(snapshot: Snapshot, entry: { ref: string; target: RefTarget }, mode: number): string[] {
  const trail = [entry.ref];
  let target = entry.target;
  while (target.kind === "role") {
    const { domain, role } = target;
    const next = snapshot.roles.find((candidate) => candidate.domain === domain && candidate.role === role)?.perMode[mode];
    if (!next) break;
    trail.push(next.ref);
    target = next.target;
  }
  return trail;
}

function RefLink({
  snapshot,
  target,
  onFollow,
  children,
}: {
  snapshot: Snapshot;
  target: RefTarget;
  onFollow?: () => void;
  children: ReactNode;
}) {
  if (target.kind === "role") {
    return (
      <Link to={{ page: "domain", name: target.domain }} hash={target.role} onClick={onFollow}>
        {children}
      </Link>
    );
  }
  if (target.kind === "constant") {
    return (
      <Link to={{ page: "constants" }} hash={constantAnchor(target.name)} onClick={onFollow}>
        {children}
      </Link>
    );
  }
  const step = snapshot.systems
    .find((system) => system.system === target.system)
    ?.steps.find((candidate) => candidate.selector === target.selector);
  return (
    <Link to={{ page: "system", name: target.system }} hash={stepAnchor(step?.publicStep ?? target.selector)} onClick={onFollow}>
      {children}
    </Link>
  );
}
