import { ChevronRight, TriangleAlert, Redo2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { earlierSpelling, type Edit, type EditTarget } from "../src/edit.js";
import type { Snapshot } from "../src/snapshot.js";
import { rolePath } from "../src/selector.js";
import type { Change } from "../src/working-copy.js";
import { Popup } from "./Popup.js";
import { Link } from "./router.js";
import { useStore } from "./store.js";

function nameOf(target: EditTarget, modes: string[]): string {
  switch (target.kind) {
    case "ref":
      return `${target.role} [${modes[target.mode]}]`;
    case "role":
    case "group":
    case "constant":
    case "system":
      return target.path;
    case "emit":
      return `${target.system} publish`;
    case "param":
      return `${target.system} ${target.path}`;
    case "default":
      return `${target.algorithm} ${target.path} (shared)`;
    case "mode":
      return `mode ${target.name}`;
    case "scheme":
      return `${target.mode} scheme`;
    case "collection":
      return `collection ${target.name}`;
    case "spelling":
      return target.key;
  }
}


type Step = "undo" | "redo" | "discard" | "save";
type Failure = { step: Step; message: string } | null;

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * What is unsaved, and the controls over it: step back and forward through
 * the edits, drop them all, or write them to the definition file.
 */
export function Changes({ working }: { working: Snapshot }) {
  const { changes, undo, redo, modes, problems } = working;
  const describeEdit = (edit: Edit) => {
    const name = nameOf(edit.target, modes);
    if (edit.action === "add" && edit.target.kind === "mode") return `add ${name} (${edit.value})`;
    if (edit.action === "set" && edit.target.kind === "spelling") return `write ${earlierSpelling(edit.target.key)} as ${edit.value}`;
    if (edit.action === "set" && edit.target.kind === "scheme") return `${name} → ${edit.value || "not set"}`;
    if (edit.action === "rename") return `rename ${name} to ${edit.name}`;
    if (edit.action === "place") return `move ${name} to ${edit.path}`;
    if (edit.action === "move") return `move ${name}`;
    if (edit.action === "remove") return `remove ${name}`;
    if (edit.action === "add" && edit.target.kind === "system") return `add system ${name}`;
    if (edit.action === "set" && edit.target.kind === "system") return `${name} → ${(JSON.parse(edit.value) as { algorithm: string }).algorithm}`;
    if (edit.action === "add" && edit.target.kind === "role") return `add role ${name}`;
    if (edit.action === "add") return `add ${name} ${edit.value}`;
    return `${name} → ${edit.value}`;
  };
  // A mode added as a copy sets a ref on every role in the same step; the mode says it all.
  const describe = (step: Edit[]) => (step.find((edit) => edit.action === "add" && edit.target.kind === "mode") ? describeEdit(step[0]) : step.map(describeEdit).join(", "));
  const summary = (change: Change) => {
    const name = nameOf(change.target, modes);
    if (change.action === "rename") return `${name}: renamed to ${nameOf(change.to, modes)}`;
    if (change.action === "move") return `${name}: moved`;
    if (change.target.kind === "mode" && change.action === "remove") return `${name}: removed`;
    if (change.target.kind === "collection") return change.action === "remove" ? `${name}: removed` : `${name}: added`;
    if (change.target.kind === "mode" && change.action === "set") return `${name}: added (${change.to})`;
    if (change.target.kind === "spelling" && change.action === "set") return `${change.from} written as ${change.to}`;
    if (change.target.kind === "scheme" && change.action === "set") return `${name}: ${change.from || "not set"} → ${change.to || "not set"}`;
    if (change.target.kind === "system") {
      if (change.action === "remove") return `${name}: system removed`;
      return change.action === "set" && change.from != null ? `${name}: algorithm and params changed` : `${name}: system added`;
    }
    if (change.target.kind === "role") return change.action === "remove" ? `${name}: role removed` : `${name}: role added`;
    if (change.action === "remove") return `${name}: removed (was ${change.from})`;
    return `${name}: ${change.from ?? "added"} → ${change.to}`;
  };
  const [failure, setFailure] = useState<Failure>(null);
  const store = useStore();

  const run = (step: Step) => {
    setFailure(null);
    const command = step === "save" ? store.save : store[step];
    command?.().catch((error: Error) => setFailure({ step, message: error.message }));
  };

  // In a text field the shortcut belongs to the field's own typing history,
  // and a picker with a pick in progress takes it first to drop that pick.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTextField(event.target)) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const step: Step | null = key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : null;
      if (!step) return;
      event.preventDefault();
      run(step);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const errors = failure ? [...problems, { path: `Could not ${failure.step}`, message: failure.message }] : problems;
  if (changes.length === 0 && errors.length === 0) return null;

  return (
    <div className="changes glass-surface">
      <div className="changes-row">
        <span className="changes-count" title={changes.map(summary).join("\n")}>
          {changes.length === 0 ? "No changes" : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`}
        </span>
        {errors.length > 0 && (
          <Popup
            title="Errors"
            className="changes-errors"
            label={
              <>
                <TriangleAlert size={14} aria-hidden />
                {errors.length} {errors.length === 1 ? "error" : "errors"}
              </>
            }
            focus="panel"
          >
            {(panel) => (
              <div className="ref-editor">
                <div className="editor-head" {...panel.handle}>
                  <span className="ref-editor-heading">Errors</span>
                  {panel.close}
                </div>
                <ul className="changes-error-list">
                  {errors.map((error) => {
                    const role = working.roles.find((candidate) => rolePath(candidate) === error.path);
                    return (
                      <li key={`${error.path}: ${error.message}`}>
                        {role ? (
                          <Link
                            className="changes-error changes-error-link"
                            to={role.group ? { page: "group", name: role.group } : { page: "roles", section: role.section }}
                            hash={role.role}
                          >
                            <span className="changes-error-text">
                              <code>{error.path}</code>
                              {error.message}
                            </span>
                            <ChevronRight size={14} aria-hidden className="changes-errors-open" />
                          </Link>
                        ) : (
                          <div className="changes-error">
                            <span className="changes-error-text">
                              <code>{error.path}</code>
                              {error.message}
                            </span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Popup>
        )}
        <button
          className="btn btn-small changes-step"
          aria-label="Undo"
          title={undo ? `Undo: ${describe(undo)}` : "Nothing to undo"}
          disabled={!undo}
          onClick={() => run("undo")}
        >
          <Undo2 size={14} aria-hidden />
        </button>
        <button
          className="btn btn-small changes-step"
          aria-label="Redo"
          title={redo ? `Redo: ${describe(redo)}` : "Nothing to redo"}
          disabled={!redo}
          onClick={() => run("redo")}
        >
          <Redo2 size={14} aria-hidden />
        </button>
      </div>
      <div className="changes-row">
        <button
          className="btn btn-small"
          disabled={changes.length === 0}
          title={changes.length === 0 ? "Nothing to discard" : "Drop every unsaved change. Redo brings them back."}
          onClick={() => run("discard")}
        >
          Discard
        </button>
        {store.save ? (
          <button
            className="btn btn-small changes-save"
            disabled={changes.length === 0 || problems.length > 0}
            title={changes.length === 0 ? "Nothing to save" : problems.length > 0 ? "Fix the errors to save" : undefined}
            onClick={() => run("save")}
          >
            Save
          </button>
        ) : (
          <span className="muted changes-save">Not saved</span>
        )}
      </div>
    </div>
  );
}
