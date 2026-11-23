import { useEffect, useRef, useState } from "react";
import type { Edit, EditTarget } from "../src/edit.js";
import { EDITABLE } from "./mode.js";
import { Popup, type PopupPanel } from "./Popup.js";
import { ParamScopeControl, unlinkEdit, type ParamScope } from "./ParamScope.js";
import { useTrying } from "./preview.js";
import { Alert } from "./Alert.js";

/** A choice param as its value; clicking it lists the options, each tried live on the page as it is picked. */
export function ChoiceParam({
  name,
  value,
  options,
  target,
  note,
  dim = false,
  readOnly = false,
  scope = null,
}: {
  name: string;
  value: string;
  options: string[];
  target: EditTarget;
  /** Where the value comes from, when that is not simply the system: "defaults", "shared as &name", "same as &name". */
  note: string | null;
  /** Shown faded: nothing writes it, so it is the algorithm's default. */
  dim?: boolean;
  /** Shown but not editable here, such as a YAML alias whose value is written elsewhere. */
  readOnly?: boolean;
  /** Where a top-level param lives, for the panel to switch; null for part of one. */
  scope?: ParamScope | null;
}) {
  const label = (
    <span>
      <code className={dim ? "muted" : undefined}>{value}</code>
      {note && (
        <span className="muted param-note">{note}</span>
      )}
    </span>
  );
  if (!EDITABLE || readOnly) return <span className="chip">{label}</span>;
  return (
    <Popup title={`Edit ${name}`} className="chip chip-editable choice-param" label={label} focus="panel">
      {(panel) => <ChoiceEditor scope={scope} name={name} original={value} options={options} target={target} panel={panel} />}
    </Popup>
  );
}

function ChoiceEditor({
  name,
  original,
  options,
  target,
  panel,
  scope,
}: {
  name: string;
  original: string;
  options: string[];
  target: EditTarget;
  panel: PopupPanel;
  scope: ParamScope | null;
}) {
  const { preview, commit, refusal } = useTrying();
  // The page shows the choice being tried, so `original` follows it; the panel compares against what it opened on.
  const [opened] = useState(original);
  const [picked, setPicked] = useState(original);
  const edit = picked !== opened ? { action: "set" as const, target, value: picked } : null;
  const latest = useRef(edit);
  latest.current = edit;
  const fellBack = useRef(false);
  const fallBack = (removal: Edit) => {
    fellBack.current = true;
    preview(null);
    commit(removal);
    panel.dismiss();
  };
  useEffect(() => preview(edit), [picked, target.kind]);
  useEffect(
    () => () => {
      if (latest.current && !panel.escaped() && !fellBack.current) commit(latest.current);
      else preview(null);
    },
    [],
  );

  return (
    <form
      className="ref-editor choice-editor"
      onSubmit={(event) => {
        event.preventDefault();
        panel.dismiss();
      }}
    >
      <div className="editor-head" {...panel.handle}>
        <span className="ref-editor-heading">{name}</span>
        {panel.close}
      </div>
      <ParamScopeControl scope={scope} unlink={() => scope && commit(unlinkEdit(scope, opened))} fallBack={fallBack} />
      <div className="choice-options" role="radiogroup" aria-label={name}>
        {options.map((option) => (
          <label key={option} className={option === picked ? "choice-option picked" : "choice-option"}>
            <input type="radio" name={name} value={option} checked={option === picked} onChange={() => setPicked(option)} />
            <code>{option}</code>
          </label>
        ))}
      </div>
      {edit && refusal && <Alert className="inline-alert">{refusal.split("\n").find((line) => line.startsWith("- "))?.slice(2) ?? refusal}</Alert>}
      <button type="submit" hidden />
    </form>
  );
}
