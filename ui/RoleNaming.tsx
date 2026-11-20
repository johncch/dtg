import { Plus } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import type { RoleTarget } from "../src/edit.js";
import { INHERIT, rolePath } from "../src/selector.js";
import type { SnapshotRole } from "../src/snapshot.js";
import { Hint } from "./Hint.js";
import { EDITABLE } from "./mode.js";
import { useTrying } from "./preview.js";
import { TrashIcon } from "./TrashIcon.js";

const targetOf = (role: Pick<SnapshotRole, "section" | "group" | "role">): RoleTarget => ({
  kind: "role",
  section: role.section,
  role: rolePath(role),
});

/** The role just added, whose row opens its name for typing once the working copy has it. */
let naming: string | null = null;

function freshName(taken: string[]): string {
  if (!taken.includes("new-role")) return "new-role";
  let count = 2;
  while (taken.includes(`new-role-${count}`)) count += 1;
  return `new-role-${count}`;
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
            naming = JSON.stringify(target);
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

/** Removes a role, once no other role's ref points at it. The last role of a group stays: without it the group has no row to add to. */
export function RoleRemove({ role, roles }: { role: SnapshotRole; roles: SnapshotRole[] }) {
  const { commit } = useTrying();
  if (!EDITABLE) return null;
  const path = rolePath(role);
  const users = roles
    .filter((other) => other.perMode.some((entry) => entry.ref === path || entry.ref.startsWith(`transparent(${path} `)))
    .map(rolePath);
  const shown = users.length > 3 ? `${users.slice(0, 3).join(", ")} and ${users.length - 3} more` : users.join(", ");
  const alone = roles.filter((other) => other.section === role.section && other.group === role.group).length === 1;
  const refusal = users.length > 0 ? `Used by ${shown}. Point them elsewhere first.` : alone ? `The only role in ${role.group || role.section}.` : null;
  return (
    <Hint text={refusal ?? "Delete"}>
      <button
        type="button"
        className="role-remove"
        aria-label={`Remove ${path}`}
        // Not `disabled`: a disabled button gets no pointer events, so its hint would never show.
        aria-disabled={refusal != null}
        onClick={() => {
          if (refusal == null) commit({ action: "remove", target: targetOf(role) });
        }}
      >
        <TrashIcon />
      </button>
    </Hint>
  );
}

/** A role's name; in the editor a double click opens it for renaming, kept on Enter or on leaving the field. */
export function RoleName({ role, siblings }: { role: SnapshotRole; siblings: SnapshotRole[] }) {
  const { commit } = useTrying();
  const [typed, setTyped] = useState<string | null>(null);
  const target = targetOf(role);
  const key = JSON.stringify(target);
  useLayoutEffect(() => {
    if (naming !== key) return;
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
  const problem = !/^[A-Za-z][\w-]*$/.test(typed)
    ? "Letters, digits, - and _, starting with a letter."
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
