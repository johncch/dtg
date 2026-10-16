import { useEffect, useState } from "react";
import type { Edit, EditTarget } from "../src/edit.js";
import type { Snapshot } from "../src/snapshot.js";
import type { Change } from "../src/working-copy.js";

function nameOf(target: EditTarget, modes: string[]): string {
  switch (target.kind) {
    case "ref":
      return `${target.role} [${modes[target.mode]}]`;
    case "constant":
      return target.path;
    case "param":
      return `${target.system} ${target.path}`;
    case "default":
      return `${target.algorithm} ${target.path} (shared)`;
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
  const { changes, undo, redo, modes } = working;
  const describeEdit = (edit: Edit) => {
    const name = nameOf(edit.target, modes);
    if (edit.action === "rename") return `rename ${name} to ${edit.name}`;
    if (edit.action === "remove") return `remove ${name}`;
    if (edit.action === "add") return `add ${name} ${edit.value}`;
    return `${name} → ${edit.value}`;
  };
  const describe = (step: Edit[]) => step.map(describeEdit).join(", ");
  const summary = (change: Change) => {
    const name = nameOf(change.target, modes);
    if (change.action === "rename") return `${name}: renamed to ${change.to.path}`;
    if (change.action === "remove") return `${name}: removed (was ${change.from})`;
    return `${name}: ${change.from ?? "added"} → ${change.to}`;
  };
  const [failure, setFailure] = useState<Failure>(null);

  const run = (step: Step) => {
    setFailure(null);
    fetch(`/api/${step}`, { method: "POST" })
      .then(async (response) => {
        if (response.ok) return;
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setFailure({ step, message: body.error ?? `the server answered ${response.status}` });
      })
      .catch((error: Error) => setFailure({ step, message: error.message }));
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

  if (changes.length === 0 && !undo && !redo) return null;

  return (
    <div className="changes">
      <div className="changes-row">
        <span title={changes.map(summary).join("\n")}>
          {changes.length === 0 ? "No changes" : `${changes.length} ${changes.length === 1 ? "change" : "changes"}`}
        </span>
        <button
          className="btn changes-step"
          aria-label="Undo"
          title={undo ? `Undo: ${describe(undo)}` : "Nothing to undo"}
          disabled={!undo}
          onClick={() => run("undo")}
        >
          ↶
        </button>
        <button
          className="btn changes-step"
          aria-label="Redo"
          title={redo ? `Redo: ${describe(redo)}` : "Nothing to redo"}
          disabled={!redo}
          onClick={() => run("redo")}
        >
          ↷
        </button>
      </div>
      {changes.length > 0 && (
        <div className="changes-row">
          <button className="btn" title="Drop every unsaved change. Redo brings them back." onClick={() => run("discard")}>
            discard
          </button>
          <button className="btn changes-save" onClick={() => run("save")}>
            save
          </button>
        </div>
      )}
      {failure && (
        <p className="changes-error">
          Could not {failure.step}: {failure.message}
        </p>
      )}
    </div>
  );
}
