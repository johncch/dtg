import { Plus } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import type { RoleTarget } from "../src/edit.js";
import { INHERIT, rolePath } from "../src/selector.js";
import type { Snapshot, SnapshotRole } from "../src/snapshot.js";
import { AddRow, ENTRY_NAME, ENTRY_NAME_RULE, EntryGrip, EntryName, EntryRemove, openNameOf } from "./EntryRow.js";
import { Popup, type PopupPanel } from "./Popup.js";
import { useTrying } from "./preview.js";
import { navigate } from "./router.js";

const targetOf = (role: Pick<SnapshotRole, "section" | "group" | "role">): RoleTarget => ({
  kind: "role",
  section: role.section,
  role: rolePath(role),
});

/**
 * How a new group's first role is called for its name to open: its row is
 * also drawn, for a moment, on the page being left, and must not open there.
 */
const onItsGroupPage = (key: string) => `${key} on its group's page`;

function freshName(taken: string[]): string {
  if (!taken.includes("new-role")) return "new-role";
  let count = 2;
  while (taken.includes(`new-role-${count}`)) count += 1;
  return `new-role-${count}`;
}

let awaitedGroup: string | null = null;

/** Opens the page of a group an edit just made, once the working copy has it. */
export function OpenAwaitedGroup({ working }: { working: Snapshot }) {
  useLayoutEffect(() => {
    if (awaitedGroup == null || !working.roles.some((role) => role.group === awaitedGroup)) return;
    const name = awaitedGroup;
    awaitedGroup = null;
    navigate({ page: "group", name });
  }, [working.roles]);
  return null;
}

/** Beside a section's heading: names a new group, which starts with one role to rename and point. */
export function NewGroup({ working, section }: { working: Snapshot; section: string }) {
  return (
    <Popup
      title={`New group in ${section}`}
      className="nav-add"
      label={
        <>
          <Plus size={14} aria-hidden />
          <span className="sr-only">New group in {section}</span>
        </>
      }
      focus="field"
    >
      {(panel) => <GroupForm working={working} section={section} panel={panel} />}
    </Popup>
  );
}

function GroupForm({ working, section, panel }: { working: Snapshot; section: string; panel: PopupPanel }) {
  const { commit } = useTrying();
  const [name, setName] = useState("");
  const inSection = working.roles.filter((role) => role.section === section);
  // The first role holds what the section's last role does, or the first palette color where the section has none.
  const last = inSection.at(-1);
  const start = working.constants[0]?.path;
  const refs = last ? last.perMode.map((entry) => (entry.inherited ? INHERIT : entry.ref)) : start ? working.modes.map(() => start) : null;
  const taken = working.roles.some((role) => role.group.split(".")[0] === name) || inSection.some((role) => role.group === "" && role.role === name);
  const problem =
    name === "" ? null : !ENTRY_NAME.test(name) ? ENTRY_NAME_RULE : taken ? `${name} is already written.` : refs == null ? "Add a palette color first, for the group's first role to hold." : null;
  return (
    <form
      className="ref-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (name === "" || problem || refs == null) return;
        const target = targetOf({ section, group: name, role: "new-role" });
        openNameOf(onItsGroupPage(JSON.stringify(target)));
        awaitedGroup = name;
        commit({ action: "add", target, value: JSON.stringify(refs) });
        panel.dismiss();
      }}
    >
      <div className="editor-head" {...panel.handle}>
        <span className="ref-editor-heading">New group</span>
        {panel.close}
      </div>
      <label className="ref-control">
        <span>group</span>
        <input
          type="text"
          className="ref-input"
          value={name}
          spellCheck={false}
          autoComplete="off"
          data-1p-ignore
          placeholder="border"
          onChange={(event) => setName(event.target.value.trim())}
        />
      </label>
      {problem && <p className="ref-error system-form-problem">{problem}</p>}
      <div className="system-form-actions">
        <button type="submit" className="btn btn-primary" disabled={name === "" || problem != null}>
          Add group
        </button>
      </div>
    </form>
  );
}

/** Closes a group's rows: adds a role after `siblings`, holding the refs of the last of them, and opens its name. */
export function NewRoleRow({ siblings, columns }: { siblings: SnapshotRole[]; columns: number }) {
  const { commit } = useTrying();
  const last = siblings.at(-1);
  if (!last) return null;
  return (
    <AddRow
      label="New role"
      columns={columns}
      onAdd={() => {
        const target = targetOf({ ...last, role: freshName(siblings.map((role) => role.role)) });
        openNameOf(JSON.stringify(target));
        commit({
          action: "add",
          target,
          value: JSON.stringify(last.perMode.map((entry) => (entry.inherited ? INHERIT : entry.ref))),
        });
      }}
    />
  );
}

/** The `entryRowProps` group of a role's row: the roles it can change places with. */
export function roleRowGroup(role: SnapshotRole): string {
  return JSON.stringify([role.section, role.group]);
}

export function RoleGrip({ role, siblings }: { role: SnapshotRole; siblings: SnapshotRole[] }) {
  const { commit } = useTrying();
  return (
    <EntryGrip
      label={rolePath(role)}
      group={roleRowGroup(role)}
      name={role.role}
      siblings={siblings.map((other) => other.role)}
      onMove={(after) => commit({ action: "move", target: targetOf(role), after })}
    />
  );
}

/**
 * Removes a role, once no other role's ref points at it. A group goes with
 * its last role; a section's last role stays, for the section to have a row to add after.
 */
export function RoleRemove({ role, roles, onGroupPage }: { role: SnapshotRole; roles: SnapshotRole[]; onGroupPage: boolean }) {
  const { commit } = useTrying();
  const path = rolePath(role);
  const inSection = roles.filter((other) => other.section === role.section);
  const lastOfGroup = role.group !== "" && !inSection.some((other) => other !== role && `${other.group}.`.startsWith(`${role.group}.`));
  return (
    <EntryRemove
      label={path}
      users={roles
        .filter((other) => other.perMode.some((entry) => entry.ref === path || entry.ref.startsWith(`transparent(${path} `)))
        .map(rolePath)}
      stays={inSection.length === 1 ? `The only role in ${role.section}.` : null}
      hint={lastOfGroup ? `Delete, and ${role.group} with it` : "Delete"}
      onRemove={() => {
        commit({ action: "remove", target: targetOf(role) });
        if (lastOfGroup && onGroupPage) navigate({ page: "roles", section: role.section }, { replace: true });
      }}
    />
  );
}

export function RoleName({ role, siblings, onGroupPage }: { role: SnapshotRole; siblings: SnapshotRole[]; onGroupPage: boolean }) {
  const { commit } = useTrying();
  const target = targetOf(role);
  const key = JSON.stringify(target);
  return (
    <EntryName
      keys={onGroupPage ? [key, onItsGroupPage(key)] : [key]}
      name={role.role}
      taken={siblings.map((other) => other.role)}
      whenTaken={(name) => `${rolePath({ ...role, role: name })} is already a role.`}
      onRename={(name) => commit({ action: "rename", target, name })}
    />
  );
}
