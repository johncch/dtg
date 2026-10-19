import { useEffect, useRef, useState } from "react";
import type { EditTarget } from "../src/edit.js";
import { STATIC } from "./mode.js";
import { Popup, type PopupPanel } from "./Popup.js";
import { useTrying } from "./preview.js";

/** A choice param as its value; clicking it lists the options, each tried live on the page as it is picked. */
export function ChoiceParam({
  name,
  value,
  options,
  target,
  source,
}: {
  name: string;
  value: string;
  options: string[];
  target: EditTarget;
  /** Where the value comes from when the system does not write it: the algorithm's default, or the shared `defaults` block. */
  source: "default" | "shared" | null;
}) {
  const label = (
    <span>
      <code className={source === "default" ? "muted" : undefined}>{value}</code>
      {source && (
        <>
          <br />
          <span className="muted">{source}</span>
        </>
      )}
    </span>
  );
  if (STATIC) return <span className="chip">{label}</span>;
  return (
    <Popup title={`Edit ${name}`} className="chip chip-editable choice-param" label={label} focus="panel">
      {(panel) => <ChoiceEditor name={name} original={value} options={options} target={target} panel={panel} />}
    </Popup>
  );
}

function ChoiceEditor({
  name,
  original,
  options,
  target,
  panel,
}: {
  name: string;
  original: string;
  options: string[];
  target: EditTarget;
  panel: PopupPanel;
}) {
  const { preview, commit, refusal } = useTrying();
  // The page shows the choice being tried, so `original` follows it; the panel compares against what it opened on.
  const [opened] = useState(original);
  const [picked, setPicked] = useState(original);
  const edit = picked !== opened ? { action: "set" as const, target, value: picked } : null;
  const latest = useRef(edit);
  latest.current = edit;
  useEffect(() => preview(edit), [picked]);
  useEffect(
    () => () => {
      if (latest.current) commit(latest.current);
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
      <div className="choice-options" role="radiogroup" aria-label={name}>
        {options.map((option) => (
          <label key={option} className={option === picked ? "choice-option picked" : "choice-option"}>
            <input type="radio" name={name} value={option} checked={option === picked} onChange={() => setPicked(option)} />
            <code>{option}</code>
          </label>
        ))}
      </div>
      {edit && refusal && <p className="ref-error">{refusal.split("\n").find((line) => line.startsWith("- "))?.slice(2) ?? refusal}</p>}
      <button type="submit" hidden />
    </form>
  );
}
