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
import { INHERIT, rolePath } from "../../src/selector.js";
import { stepAnchor } from "../Strip.js";
import { constantAnchor } from "./ConstantsPage.js";

export function GroupPage({ snapshot, group }: { snapshot: Snapshot; group: string }) {
  const hash = useScrollToHash(group);
  const roles = snapshot.roles.filter((role) => role.group === group);
  return (
    <>
      <h1>{group}</h1>
      {snapshot.groupNotes.roles[group] && <p className="note">{snapshot.groupNotes.roles[group]}</p>}
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

/**
 * Every role in a section, or in the whole definition, by group, in one table
 * so the mode columns line up. Roles written straight in a section have no
 * group and no heading row.
 */
export function RolesPage({ snapshot, section }: { snapshot: Snapshot; section?: string }) {
  const hash = useScrollToHash(section ?? "roles");
  const shown = section ? snapshot.roles.filter((role) => role.section === section) : snapshot.roles;
  const groups = [...new Set(shown.map((role) => role.group))];
  const named = groups.filter((group) => group !== "").length;
  return (
    <>
      <h1>{section ?? "All roles"}</h1>
      <p className="sub">
        {shown.length} roles{named > 0 ? ` in ${named} ${named === 1 ? "group" : "groups"}` : ""}
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
          {groups.map((group) => (
            <Fragment key={group}>
              {group !== "" && (
                <tr className="group-row">
                  <td colSpan={snapshot.modes.length + 1}>
                    <Link to={{ page: "group", name: group }}>{group}</Link>
                    {snapshot.groupNotes.roles[group] && <div className="role-note group-note">{snapshot.groupNotes.roles[group]}</div>}
                  </td>
                </tr>
              )}
              {shown
                .filter((role) => role.group === group)
                .map((role) => (
                  <RoleRow
                    key={role.role}
                    snapshot={snapshot}
                    role={role}
                    id={group === "" ? role.role : undefined}
                    targeted={group === "" && role.role === hash}
                  />
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
  /** Set where a link can land on the row: on a group's page, or a section's for a role in no group. */
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
                    role: rolePath(role),
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
    const { group, role } = target;
    const next = snapshot.roles.find((candidate) => candidate.group === group && candidate.role === role)?.perMode[mode];
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
    const section = snapshot.roles.find((role) => role.group === target.group && role.role === target.role)?.section;
    return (
      <Link to={target.group ? { page: "group", name: target.group } : { page: "roles", section }} hash={target.role} onClick={onFollow}>
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
