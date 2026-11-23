import { Plus, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { Edit } from "../src/engine/edit.js";
import { TOP_LEVEL_RESERVED } from "../src/engine/resolve.js";
import { rolePath } from "../src/engine/selector.js";
import type { Snapshot } from "../src/engine/snapshot.js";
import { Alert } from "./Alert.js";
import { ENTRY_NAME, ENTRY_NAME_RULE, usedByRefusal } from "./EntryRow.js";
import { Popup, type PopupPanel } from "./Popup.js";
import { firstError, useTrying } from "./preview.js";
import { roleUsers } from "./RoleNaming.js";

/** Why `name` cannot be a collection's, `current` aside; null when it can. */
function nameProblem(name: string, working: Snapshot, current: string | null): string | null {
  if (name === "" || name === current) return null;
  if (!ENTRY_NAME.test(name)) return ENTRY_NAME_RULE;
  if (TOP_LEVEL_RESERVED.includes(name)) return `${name} is a key the definition keeps for itself.`;
  if (working.sections.includes(name)) return `${name} is already a collection.`;
  return null;
}

/** Closes the sidebar: names a new collection, added empty, and opens its page. */
export function NewCollection({ working }: { working: Snapshot }) {
  return (
    <Popup
      title="New collection"
      className="nav-new-collection"
      label={
        <>
          <Plus size={14} aria-hidden />
          New collection
        </>
      }
      focus="field"
    >
      {(panel) => <CollectionForm working={working} editing={null} panel={panel} />}
    </Popup>
  );
}

/** Beside a collection's title: renames it, or removes it with its roles. */
export function CollectionSettings({ working, section }: { working: Snapshot; section: string }) {
  return (
    <Popup
      title={`${section} settings`}
      className="system-settings"
      label={
        <>
          <SlidersHorizontal size={16} aria-hidden />
          <span className="sr-only">Collection settings</span>
        </>
      }
      focus="panel"
    >
      {(panel) => <CollectionForm working={working} editing={section} panel={panel} />}
    </Popup>
  );
}

function CollectionForm({ working, editing, panel }: { working: Snapshot; editing: string | null; panel: PopupPanel }) {
  const { commit } = useTrying();
  const [name, setName] = useState(editing ?? "");
  const [refused, setRefused] = useState<string | null>(null);
  const problem = nameProblem(name, working, editing);
  const ready = name !== "" && name !== editing && problem == null;

  const keep = (edit: Edit, opens: string | null) => {
    const refusal = commit(edit, opens == null ? undefined : { page: { page: "roles", section: opens } });
    if (refusal) {
      setRefused(firstError(refusal));
      return;
    }
    panel.dismiss();
  };

  const remove = () => {
    if (editing == null) return;
    const inside = new Set(working.roles.filter((role) => role.section === editing).map(rolePath));
    const users = [...roleUsers(working.roles)]
      .filter(([pointed]) => inside.has(pointed))
      .flatMap(([, by]) => by)
      .filter((by) => !inside.has(by));
    if (users.length > 0) {
      setRefused(usedByRefusal([...new Set(users)]));
      return;
    }
    keep({ action: "remove", target: { kind: "collection", name: editing } }, null);
  };

  return (
    <form
      className="ref-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        keep(
          editing == null
            ? { action: "add", target: { kind: "collection", name }, value: "{}" }
            : { action: "rename", target: { kind: "collection", name: editing }, name },
          name,
        );
      }}
    >
      <div className="editor-head" {...panel.handle}>
        <span className="ref-editor-heading">{editing ?? "New collection"}</span>
        {panel.close}
      </div>
      <label className="ref-control">
        <span>collection</span>
        <input
          type="text"
          className="ref-input"
          value={name}
          spellCheck={false}
          autoComplete="off"
          data-1p-ignore
          placeholder="roles"
          onChange={(event) => {
            setName(event.target.value.trim());
            setRefused(null);
          }}
        />
      </label>
      {(problem ?? refused) && <Alert className="inline-alert">{problem ?? refused}</Alert>}
      <div className="system-form-actions collection-form-actions">
        {editing != null && (
          <button type="button" className="btn system-form-remove" onClick={remove}>
            Delete
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          {editing == null ? "Add collection" : "Update"}
        </button>
      </div>
    </form>
  );
}
