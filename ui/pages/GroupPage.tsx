import { Fragment, useMemo, type ReactNode } from "react";
import { throughTransparent, type RefTarget } from "../../src/resolve.js";
import type { Snapshot, SnapshotRole } from "../../src/snapshot.js";
import type { EditTarget } from "../../src/edit.js";
import { ColorChip } from "../ColorChip.js";
import { ControlsCell, ControlsHead, entryRowProps } from "../EntryRow.js";
import { NewRoleRow, RoleDuplicate, RoleGrip, roleUsers, RoleGroupName, RoleName, RoleRemove, roleRowGroup } from "../RoleNaming.js";
import { Link, useScrollToHash } from "../router.js";
import { CollectionSettings } from "../CollectionNaming.js";
import { EDITABLE } from "../mode.js";
import { INHERIT, rolePath } from "../../src/selector.js";
import { stepAnchor } from "../Strip.js";
import { constantAnchor } from "../ConstantRow.js";

export function GroupPage({ snapshot, group }: { snapshot: Snapshot; group: string }) {
  const hash = useScrollToHash(group);
  const roles = snapshot.roles.filter((role) => role.group === group);
  const users = useMemo(() => roleUsers(snapshot.roles), [snapshot.roles]);
  return (
    <>
      <h1 className="entry-head">
        <RoleGroupName snapshot={snapshot} group={group} />
      </h1>
      {snapshot.groupNotes.roles[group] && <p className="note">{snapshot.groupNotes.roles[group]}</p>}
      <p className="sub">{roles.length} roles</p>
      <table className="roles-table">
        <thead>
          <tr>
            <th>Role</th>
            <ControlsHead />
            {snapshot.modes.map((mode) => (
              <th key={mode}>{mode}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <RoleRow key={role.role} snapshot={snapshot} role={role} siblings={roles} users={users} onGroupPage id={role.role} targeted={role.role === hash} />
          ))}
          <NewRoleRow siblings={roles} columns={snapshot.modes.length + 2} />
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
export function RolesPage({ snapshot, working, section }: { snapshot: Snapshot; working: Snapshot; section?: string }) {
  const hash = useScrollToHash(section ?? "roles");
  const shown = section ? snapshot.roles.filter((role) => role.section === section) : snapshot.roles;
  const written = [...new Set(shown.map((role) => role.group))];
  const groups = [...written.filter((group) => group === ""), ...written.filter((group) => group !== "")];
  const named = groups.filter((group) => group !== "").length;
  const users = useMemo(() => roleUsers(snapshot.roles), [snapshot.roles]);
  return (
    <>
      <div className="system-head">
        <h1>{section ?? "All roles"}</h1>
        {EDITABLE && section != null && <CollectionSettings key={section} working={working} section={section} />}
      </div>
      <p className="sub">
        {shown.length} {shown.length === 1 ? "role" : "roles"}{named > 0 ? ` in ${named} ${named === 1 ? "group" : "groups"}` : ""}
      </p>
      <table className="roles-table">
        <thead>
          <tr>
            <th>Role</th>
            <ControlsHead />
            {snapshot.modes.map((mode) => (
              <th key={mode}>{mode}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const inGroup = shown.filter((role) => role.group === group);
            return (
              <Fragment key={group}>
                {group !== "" && (
                  <tr className="group-row">
                    <td colSpan={snapshot.modes.length + 2}>
                      <Link to={{ page: "group", name: group }}>{group}</Link>
                      {snapshot.groupNotes.roles[group] && <div className="role-note group-note">{snapshot.groupNotes.roles[group]}</div>}
                    </td>
                  </tr>
                )}
                {inGroup.map((role) => (
                  <RoleRow
                    key={role.role}
                    snapshot={snapshot}
                    role={role}
                    siblings={inGroup}
                    users={users}
                    id={group === "" ? role.role : undefined}
                    targeted={group === "" && role.role === hash}
                  />
                ))}
                <NewRoleRow siblings={inGroup} columns={snapshot.modes.length + 2} />
              </Fragment>
            );
          })}
          {section != null && groups.length === 0 && snapshot.constants.length > 0 && (
            <NewRoleRow siblings={[]} columns={snapshot.modes.length + 2} empty={{ section, refs: snapshot.modes.map(() => snapshot.constants[0].path) }} />
          )}
        </tbody>
      </table>
    </>
  );
}

function RoleRow({
  snapshot,
  role,
  siblings,
  users,
  onGroupPage = false,
  id,
  targeted,
}: {
  snapshot: Snapshot;
  role: SnapshotRole;
  /** The roles of its group, its own among them. */
  siblings: SnapshotRole[];
  /** `roleUsers` of every role. */
  users: Map<string, string[]>;
  onGroupPage?: boolean;
  /** Set where a link can land on the row: on a group's page, or a section's for a role in no group. */
  id?: string;
  targeted: boolean;
}) {
  return (
    <tr id={id} className={targeted ? "target" : undefined} {...entryRowProps(roleRowGroup(role), role.role)}>
      <td>
        <div className="entry-head">
          <RoleGrip role={role} siblings={siblings} />
          <RoleName role={role} roles={snapshot.roles} onGroupPage={onGroupPage} />
        </div>
        {role.note && <div className="role-note">{role.note}</div>}
      </td>
      <ControlsCell>
        <RoleRemove role={role} roles={snapshot.roles} users={users.get(rolePath(role)) ?? []} />
        <RoleDuplicate role={role} siblings={siblings} />
      </ControlsCell>
      {role.perMode.map((entry, index) => {
        const parent = snapshot.modeDetails[index].extends;
        const trail = refTrail(snapshot, entry, index);
        const trailText = <code>{trail.join(" → ")}</code>;
        const inheritedNote = entry.inherited && <span className="muted">inherited from {parent}</span>;
        const target: EditTarget = { kind: "ref", section: role.section, role: rolePath(role), mode: index };
        return (
          <td key={index}>
            <ColorChip
              color={entry.kind === "gradient" ? entry : entry.color}
              label={entry.ref}
              value={entry.inherited ? INHERIT : entry.ref}
              className={entry.inherited ? "chip-inherited" : undefined}
              edit={target}
              reference={
                <>
                  <RefLink snapshot={snapshot} target={entry.target}>
                    {trailText}
                  </RefLink>
                  {inheritedNote}
                </>
              }
              editor={{
                paletteGradients: snapshot.gradients,
                systems: snapshot.systems,
                roles: snapshot.roles.flatMap((other) => {
                  const pointed = other.perMode[index];
                  return other !== role ? [{ path: rolePath(other), color: pointed.kind === "color" ? pointed.color : pointed }] : [];
                }),
                transparent: true,
                inherits: parent == null ? null : { mode: parent, ref: role.perMode[snapshot.modes.indexOf(parent)].ref },
              }}
            />
          </td>
        );
      })}
    </tr>
  );
}

/** The ref, then each ref it leads to through other roles, down to the step or constant the color comes from. */
function refTrail(snapshot: Snapshot, entry: { ref: string; target: RefTarget }, mode: number): string[] {
  const trail = [entry.ref];
  let target = throughTransparent(entry.target);
  while (target.kind === "role") {
    const { group, role } = target;
    const next = snapshot.roles.find((candidate) => candidate.group === group && candidate.role === role)?.perMode[mode];
    if (!next) break;
    trail.push(next.ref);
    target = throughTransparent(next.target);
  }
  return trail;
}

function RefLink({
  snapshot,
  target: written,
  onFollow,
  children,
}: {
  snapshot: Snapshot;
  target: RefTarget;
  onFollow?: () => void;
  children: ReactNode;
}) {
  const target = throughTransparent(written);
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
  if (target.kind === "literal" || target.kind === "gradient") return <>{children}</>;
  const step = snapshot.systems
    .find((system) => system.system === target.system)
    ?.steps.find((candidate) => candidate.selector === target.selector);
  return (
    <Link to={{ page: "system", name: target.system }} hash={stepAnchor(step?.publicStep ?? target.selector)} onClick={onFollow}>
      {children}
    </Link>
  );
}
