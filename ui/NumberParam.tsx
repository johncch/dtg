import { useEffect, useRef, useState } from "react";
import type { EditTarget } from "../src/edit.js";
import { EDITABLE } from "./mode.js";
import { Popup, type PopupPanel } from "./Popup.js";
import { useTrying } from "./preview.js";

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
}: {
  name: string;
  value: number;
  target: EditTarget;
  range: Range | null;
  /** Where the value comes from, when that is not simply the system: "default", "shared", "shared as &name", "same as &name". */
  note?: string | null;
  /** Shown faded: nothing writes it, so it is the algorithm's default. */
  dim?: boolean;
  /** Shown but not editable here, such as a YAML alias whose value is written elsewhere. */
  readOnly?: boolean;
}) {
  const label = (
    <span>
      <code className={dim ? "muted" : undefined}>{value}</code>
      {note && (
        <>
          <br />
          <span className="muted">{note}</span>
        </>
      )}
    </span>
  );
  if (!EDITABLE || readOnly) return <span className="chip">{label}</span>;
  return (
    <Popup title={`Edit ${name}`} className="chip chip-editable number-param" label={label} focus="field">
      {(panel) => <NumberEditor name={name} original={value} target={target} range={range} panel={panel} />}
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
}: {
  name: string;
  original: number;
  target: EditTarget;
  range: Range | null;
  panel: PopupPanel;
}) {
  const { preview, commit, refusal } = useTrying();
  // The page shows the number being tried, so `original` follows it; the panel compares against what it opened on.
  const [opened] = useState(original);
  const [text, setText] = useState(String(opened));
  const parsed = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(parsed);
  // Arrow keys and the slider step by what the value is written in: whole numbers by 1, fractions by 0.01.
  const step = Number.isInteger(opened) ? 1 : 0.01;
  const edit = valid && parsed !== opened ? { action: "set" as const, target, value: String(parsed) } : null;
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
        <span className="ref-editor-heading">{name}</span>
        {panel.close}
      </div>
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
      {!valid && <p className="ref-error">Not a number.</p>}
      {edit && refusal && <p className="ref-error">{firstError(refusal)}</p>}
    </form>
  );
}

/** The first of a refusal's errors: the reason, before everything that fails because of it. */
function firstError(refusal: string): string {
  const first = refusal.split("\n").find((line) => line.startsWith("- "));
  return first ? first.slice(2) : refusal;
}
