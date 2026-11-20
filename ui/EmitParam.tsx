import { useEffect, useRef, useState } from "react";
import type { SnapshotSystem } from "../src/snapshot.js";
import { emitEdit } from "./emit-list.js";
import { EDITABLE } from "./mode.js";
import { Popup, type PopupPanel } from "./Popup.js";
import { useTrying } from "./preview.js";

/** A system's `emit` list as it is written; clicking it opens the whole list as text, tried live on the page. */
export function EmitParam({ system }: { system: SnapshotSystem }) {
  const label =
    system.emit.length === 0 ? (
      <code className="muted">none</code>
    ) : (
      <code>{system.emit.length > 3 ? `${system.emit.length} values` : system.emit.join(", ")}</code>
    );
  if (!EDITABLE) return <span className="chip">{label}</span>;
  return (
    <Popup title="Edit emit" className="chip chip-editable" label={label} focus="field">
      {(panel) => <EmitEditor system={system} panel={panel} />}
    </Popup>
  );
}

function selectorsOf(text: string): string[] {
  return text
    .split(",")
    .map((selector) => selector.trim().split(/\s+/).join(" "))
    .filter((selector) => selector !== "");
}

/** Kept on dismiss like every other edit; a list the definition cannot take is shown why and not kept. */
function EmitEditor({ system, panel }: { system: SnapshotSystem; panel: PopupPanel }) {
  const { preview, commit, refusal } = useTrying();
  // The page shows the list being tried, so `system.emit` follows it; the panel compares against what it opened on.
  const [opened] = useState(system.emit);
  const [text, setText] = useState(opened.join(", "));
  const selectors = selectorsOf(text);
  const edit = selectors.join(",") !== opened.join(",") ? emitEdit(system, selectors) : null;
  const latest = useRef(edit);
  latest.current = edit;
  useEffect(() => preview(edit), [text]);
  useEffect(
    () => () => {
      if (latest.current && !panel.escaped()) commit(latest.current);
      else preview(null);
    },
    [],
  );

  return (
    <form
      className="ref-editor"
      onSubmit={(event) => {
        event.preventDefault();
        panel.dismiss();
      }}
    >
      <div className="editor-head" {...panel.handle}>
        <span className="ref-editor-heading">emit</span>
        {panel.close}
      </div>
      <input
        className="ref-input"
        type="text"
        aria-label="emit"
        autoComplete="off"
        data-1p-ignore
        placeholder="50, 500, 950"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <p className="ref-error">Steps to publish even when no role uses them, separated by commas.</p>
      {edit && refusal && <p className="ref-error system-form-problem">{firstError(refusal)}</p>}
    </form>
  );
}

/** The first of a refusal's errors: the reason, before everything that fails because of it. */
function firstError(refusal: string): string {
  const first = refusal.split("\n").find((line) => line.startsWith("- "));
  return first ? first.slice(2) : refusal;
}
