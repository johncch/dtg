import { Plus } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import type { RoleTarget } from "../src/edit.js";
import { INHERIT, rolePath } from "../src/selector.js";
import type { Snapshot, SnapshotRole } from "../src/snapshot.js";
import { Hint } from "./Hint.js";
import { EDITABLE } from "./mode.js";
import { Popup, type PopupPanel } from "./Popup.js";
import { useTrying } from "./preview.js";
import { navigate } from "./router.js";
import { TrashIcon } from "./TrashIcon.js";

const targetOf = (role: Pick<SnapshotRole, "section" | "group" | "role">): RoleTarget => ({
  kind: "role",
  section: role.section,
  role: rolePath(role),
});

/**
 * The role just added, whose row opens its name for typing once the working
 * copy has it. A new group's first role waits for its row on the group's own
 * page: the page being left draws the row too, for a moment.
 */
let naming: { role: string; onGroupPage: boolean } | null = null;

function freshName(taken: string[]): string {
  if (!taken.includes("new-role")) return "new-role";
  let count = 2;
  while (taken.includes(`new-role-${count}`)) count += 1;
  return `new-role-${count}`;
}

const NAME = /^[A-Za-z][\w-]*$/;
const NAME_RULE = "Letters, digits, - and _, starting with a letter.";

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
    name === "" ? null : !NAME.test(name) ? NAME_RULE : taken ? `${name} is already written.` : refs == null ? "Add a palette color first, for the group's first role to hold." : null;
  return (
    <form
      className="ref-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (name === "" || problem || refs == null) return;
        const target = targetOf({ section, group: name, role: "new-role" });
        naming = { role: JSON.stringify(target), onGroupPage: true };
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
  if (!EDITABLE || !last) return null;
  return (
    <tr className="role-add">
      <td colSpan={columns}>
        <button
          type="button"
          onClick={() => {
            const target = targetOf({ ...last, role: freshName(siblings.map((role) => role.role)) });
            naming = { role: JSON.stringify(target), onGroupPage: false };
            commit({
              action: "add",
              target,
              value: JSON.stringify(last.perMode.map((entry) => (entry.inherited ? INHERIT : entry.ref))),
            });
          }}
        >
          <Plus size={14} aria-hidden />
          New role
        </button>
      </td>
    </tr>
  );
}

/**
 * Removes a role, once no other role's ref points at it. A group goes with
 * its last role; a section's last role stays, for the section to have a row to add after.
 */
export function RoleRemove({ role, roles, onGroupPage }: { role: SnapshotRole; roles: SnapshotRole[]; onGroupPage: boolean }) {
  const { commit } = useTrying();
  if (!EDITABLE) return null;
  const path = rolePath(role);
  const users = roles
    .filter((other) => other.perMode.some((entry) => entry.ref === path || entry.ref.startsWith(`transparent(${path} `)))
    .map(rolePath);
  const shown = users.length > 3 ? `${users.slice(0, 3).join(", ")} and ${users.length - 3} more` : users.join(", ");
  const inSection = roles.filter((other) => other.section === role.section);
  const lastOfGroup = role.group !== "" && !inSection.some((other) => other !== role && `${other.group}.`.startsWith(`${role.group}.`));
  const refusal =
    users.length > 0 ? `Used by ${shown}. Point them elsewhere first.` : inSection.length === 1 ? `The only role in ${role.section}.` : null;
  return (
    <Hint text={refusal ?? (lastOfGroup ? `Delete, and ${role.group} with it` : "Delete")}>
      <button
        type="button"
        className="role-remove"
        aria-label={`Remove ${path}`}
        // Not `disabled`: a disabled button gets no pointer events, so its hint would never show.
        aria-disabled={refusal != null}
        onClick={() => {
          if (refusal != null) return;
          commit({ action: "remove", target: targetOf(role) });
          if (lastOfGroup && onGroupPage) navigate({ page: "roles", section: role.section }, { replace: true });
        }}
      >
        <TrashIcon />
      </button>
    </Hint>
  );
}

/** A role's name; in the editor a double click opens it for renaming, kept on Enter or on leaving the field. */
export function RoleName({ role, siblings, onGroupPage }: { role: SnapshotRole; siblings: SnapshotRole[]; onGroupPage: boolean }) {
  const { commit } = useTrying();
  const [typed, setTyped] = useState<string | null>(null);
  const target = targetOf(role);
  const key = JSON.stringify(target);
  useLayoutEffect(() => {
    if (naming?.role !== key || (naming.onGroupPage && !onGroupPage)) return;
    naming = null;
    setTyped(role.role);
  }, [key]);

  if (!EDITABLE) return <code>{role.role}</code>;
  if (typed == null) {
    return (
      <code className="role-name" title="Double-click to rename" onDoubleClick={() => setTyped(role.role)}>
        {role.role}
      </code>
    );
  }
  const problem = !NAME.test(typed)
    ? NAME_RULE
    : typed !== role.role && siblings.some((other) => other.role === typed)
      ? `${rolePath({ ...role, role: typed })} is already a role.`
      : null;
  const keep = () => {
    if (problem) return false;
    if (typed !== role.role) commit({ action: "rename", target, name: typed });
    setTyped(null);
    return true;
  };
  return (
    <>
      <input
        type="text"
        className="ref-input role-name-input"
        aria-label={`Name of ${rolePath(role)}`}
        value={typed}
        size={Math.max(typed.length + 1, 8)}
        spellCheck={false}
        autoComplete="off"
        data-1p-ignore
        autoFocus
        onFocus={(event) => event.target.select()}
        onChange={(event) => setTyped(event.target.value.trim())}
        onBlur={() => keep() || setTyped(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") keep();
          if (event.key === "Escape") setTyped(null);
        }}
      />
      {problem && <p className="ref-error system-form-problem">{problem}</p>}
    </>
  );
}
