import { useEffect, useRef, useState } from "react";
import type { Edit, EditTarget } from "../src/engine/edit.js";
import { EDITABLE } from "./mode.js";
import { Popup, type PopupPanel } from "./Popup.js";
import { ParamScopeControl, unlinkEdit, type ParamScope } from "./ParamScope.js";
import { firstError, useTrying } from "./preview.js";
import { Alert } from "./Alert.js";

type Range = { min: number; max: number };

/** A number param as its value; clicking it opens a field, and a slider when the algorithm bounds it, tried live on the page. */
export function NumberParam({
  name,
  value,
  target,
  range,
  note = null,
  dim = false,
  readOnly = false,
  scope = null,
  compose,
}: {
  name: string;
  value: number;
  target: EditTarget;
  range: Range | null;
  /** Where the value comes from, when that is not simply the system: "defaults", "shared as &name", "same as &name". */
  note?: string | null;
  /** Shown faded: nothing writes it, so it is the algorithm's default. */
  dim?: boolean;
  /** Shown but not editable here, such as a YAML alias whose value is written elsewhere. */
  readOnly?: boolean;
  /** Where a top-level param lives, for the panel to switch; null for part of one. */
  scope?: ParamScope | null;
  /** Writes the whole param from this value, when the value is one part of it, such as one end of a value per end. */
  compose?: (n: number) => string;
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
    <Popup title={`Edit ${name}`} className="chip chip-editable number-param" label={label} focus="field">
      {(panel) => <NumberEditor scope={scope} compose={compose} name={name} original={value} target={target} range={range} panel={panel} />}
    </Popup>
  );
}

/** Kept on dismiss like every other edit; a value the definition cannot take is shown why and not kept. */
function NumberEditor({
  name,
  original,
  target,
  range,
  panel,
  scope,
  compose,
}: {
  name: string;
  original: number;
  target: EditTarget;
  range: Range | null;
  panel: PopupPanel;
  scope: ParamScope | null;
  compose?: (n: number) => string;
}) {
  const { preview, commit, refusal } = useTrying();
  // The page shows the number being tried, so `original` follows it; the panel compares against what it opened on.
  const [opened] = useState(original);
  const [text, setText] = useState(String(opened));
  const parsed = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(parsed);
  // Arrow keys and the slider step by what the value is written in: whole numbers by 1, fractions by 0.01.
  const step = Number.isInteger(opened) ? 1 : 0.01;
  const edit = valid && parsed !== opened ? { action: "set" as const, target, value: compose ? compose(parsed) : String(parsed) } : null;
  const latest = useRef(edit);
  latest.current = edit;
  const fellBack = useRef(false);
  const fallBack = (removal: Edit) => {
    fellBack.current = true;
    preview(null);
    commit(removal);
    panel.dismiss();
  };
  useEffect(() => preview(edit), [text, target.kind]);
  useEffect(
    () => () => {
      if (latest.current && !panel.escaped() && !fellBack.current) commit(latest.current);
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
        <span className="ref-editor-heading">{name}</span>
        {panel.close}
      </div>
      <ParamScopeControl scope={scope} unlink={() => scope && commit(unlinkEdit(scope, String(opened)))} fallBack={fallBack} />
      <input
        className="ref-input"
        type="number"
        aria-label={name}
        step={step}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {range && (
        <input
          className="number-slider"
          type="range"
          aria-label={`${name} slider`}
          min={range.min}
          max={range.max}
          step={step}
          value={valid ? parsed : opened}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      {!valid && <Alert className="inline-alert">Not a number.</Alert>}
      {edit && refusal && <Alert className="inline-alert">{firstError(refusal)}</Alert>}
    </form>
  );
}
