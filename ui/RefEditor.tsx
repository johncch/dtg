import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Selector, SelectorField, SelectorShape } from "../src/contract.js";
import type { Color } from "../src/color-math.js";
import type { EditTarget } from "../src/edit.js";
import { formatRef, formatSelector, INHERIT, parseCall, parseSelector } from "../src/selector.js";
import type { SnapshotConstant, SnapshotSystem } from "../src/snapshot.js";
import { ColorFacts } from "./ColorTip.js";
import type { PopupPanel } from "./Popup.js";
import { useTrying } from "./preview.js";
import { useValueInFile } from "./working.js";

/**
 * The ref a role holds for one mode. What it points at is chosen from the
 * systems and constants; a system then gets a control for each part its
 * algorithm declares, a constant one for its opacity. A mode that extends
 * another can instead say nothing and inherit. Any ref can also be edited as
 * text, where inheriting is `~`. Under the controls is the color the ref
 * comes to. The app is drawn from the ref being tried while it
 * resolves, and dismissing keeps it as an unsaved change.
 */
export function RefEditor({
  written,
  target,
  heading,
  inherits,
  color,
  reference,
  systems,
  constants,
  panel,
}: {
  /** `INHERIT` when the role says nothing for this mode. */
  written: string;
  target: EditTarget & { kind: "ref" };
  heading: string;
  /** The mode this one extends and the ref it would take from it, or null for a mode that extends nothing. */
  inherits: { mode: string; ref: string } | null;
  /** The color the ref as drawn comes to, and a link to what that ref points at. */
  color: Color;
  reference: ReactNode;
  systems: SnapshotSystem[];
  constants: SnapshotConstant[];
  panel: PopupPanel;
}) {
  const { preview, commit, refusal } = useTrying();
  const valueInFile = useValueInFile(target);
  // The cell redraws with the ref being tried, so the one the definition had
  // is taken once, at the moment of opening.
  const [original] = useState(written);
  const [text, setText] = useState(original);
  const value = text.trim();
  const edit = value !== original ? { target, value } : null;
  const latest = useRef(edit);
  latest.current = edit;
  useEffect(() => preview(edit), [value]);
  useEffect(
    () => () => {
      // The server refuses a ref that does not resolve, so a bad one left in
      // the field is dropped rather than kept.
      if (latest.current) commit(latest.current);
      else preview(null);
    },
    [],
  );

  const inheriting = value === INHERIT;
  const pointing = inheriting ? null : pointingOf(value, systems, constants);
  // Leaving inheritance starts from the ref that was inherited, not from nothing.
  const startingFrom = inheriting && inherits ? pointingOf(inherits.ref, systems, constants) : pointing;
  const point = (next: Pointing) => setText(refOf(next));

  return (
    <form
      className="ref-editor"
      onSubmit={(event) => {
        event.preventDefault();
        panel.dismiss();
      }}
    >
      <div className="editor-head" {...panel.handle}>
        <span className="ref-editor-heading">{heading}</span>
        {panel.close}
      </div>
      <div className="ref-control ref-source">
        <SourceControl
          pointing={pointing}
          startingFrom={startingFrom}
          inherits={inherits}
          inheriting={inheriting}
          systems={systems}
          constants={constants}
          onChange={point}
          onInherit={() => setText(INHERIT)}
        />
      </div>
      <div className="ref-controls">
        {pointing?.kind === "step" && <StepControls step={pointing} onChange={point} />}
        {pointing?.kind === "constant" && <ConstantControls constant={pointing} onChange={point} />}
        <input
          className="ref-input"
          type="text"
          aria-label="Ref"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
        />
        {edit && refusal && <p className="ref-error">{refusal}</p>}
      </div>
      <div className={edit && refusal ? "ref-color ref-color-stale" : "ref-color"}>
        <ColorFacts color={color} reference={reference} />
      </div>
      {valueInFile != null && (
        <button type="button" className="btn ref-in-file" onClick={() => setText(valueInFile)}>
          <span className="editor-file">file</span> <code>{valueInFile}</code>
        </button>
      )}
    </form>
  );
}

type Step = { kind: "step"; system: SnapshotSystem; selector: Selector };
/** `opacity` null is the constant itself; a number is it taken through transparent(). */
type Constant = { kind: "constant"; path: string; opacity: number | null };
type Pointing = Step | Constant;

/** What the ref points at, or null when it is another role or does not read as a ref. */
function pointingOf(ref: string, systems: SnapshotSystem[], constants: SnapshotConstant[]): Pointing | null {
  if (constants.some((constant) => constant.path === ref)) return { kind: "constant", path: ref, opacity: null };
  const call = parseCall(ref);
  if (!call) return null;
  if (call.name === "transparent") {
    const [path, written, ...rest] = call.selector.split(" ");
    const opacity = Number(written);
    const known = constants.some((constant) => constant.path === path);
    if (!known || written == null || rest.length > 0 || !(opacity >= 0 && opacity <= 100)) return null;
    return { kind: "constant", path, opacity };
  }
  const system = systems.find((candidate) => candidate.system === call.name);
  if (!system) return null;
  try {
    return { kind: "step", system, selector: parseSelector(system.algorithm, system.selector, call.selector).values };
  } catch {
    return null;
  }
}

function refOf(pointing: Pointing): string {
  if (pointing.kind === "step") {
    return formatRef(pointing.system.system, formatSelector(pointing.system.selector, pointing.selector));
  }
  return pointing.opacity == null ? pointing.path : formatRef("transparent", `${pointing.path} ${pointing.opacity}`);
}

/** A selector for `shape` that keeps what it can of what the ref pointed at before. */
function carriedOver(from: Pointing | null, shape: SelectorShape): Selector {
  const parts = from?.kind === "step" ? Object.values(from.selector) : [from?.opacity];
  const numbers = parts.filter((part) => typeof part === "number");
  const form = from?.kind === "step" ? from.selector.form : null;
  const selector: Selector = { form: (shape.forms ?? []).includes(String(form)) ? form : null };
  for (const field of shape.fields) {
    if (field.kind === "number") {
      selector[field.name] = Math.min(field.max, Math.max(field.min, numbers[0] ?? field.min));
    } else {
      selector[field.name] = field.options.find((option) => (parts as unknown[]).includes(option)) ?? field.options[0];
    }
  }
  return selector;
}

const SLIDER_STEP = 0.5;
const OTHER = "";
const INHERITED = "inherit";

function SourceControl({
  pointing,
  startingFrom,
  inherits,
  inheriting,
  systems,
  constants,
  onChange,
  onInherit,
}: {
  pointing: Pointing | null;
  /** What a newly chosen system carries its selector over from. */
  startingFrom: Pointing | null;
  inherits: { mode: string } | null;
  inheriting: boolean;
  systems: SnapshotSystem[];
  constants: SnapshotConstant[];
  onChange: (pointing: Pointing) => void;
  onInherit: () => void;
}) {
  const current = inheriting
    ? INHERITED
    : pointing == null
      ? OTHER
      : pointing.kind === "step"
        ? `system ${pointing.system.system}`
        : `constant ${pointing.path}`;
  return (
    <select
      aria-label="From"
      value={current}
      onChange={(event) => {
        const [kind, name] = event.target.value.split(" ");
        if (kind === INHERITED) {
          onInherit();
          return;
        }
        if (kind === "constant") {
          onChange({ kind: "constant", path: name, opacity: null });
          return;
        }
        const system = systems.find((candidate) => candidate.system === name)!;
        onChange({ kind: "step", system, selector: carriedOver(startingFrom, system.selector) });
      }}
    >
      {current === OTHER && <option value={OTHER}>typed below</option>}
      {inherits && <option value={INHERITED}>inherit from {inherits.mode}</option>}
      <optgroup label="Systems">
        {systems.map((system) => (
          <option key={system.system} value={`system ${system.system}`}>
            {system.system}
          </option>
        ))}
      </optgroup>
      {constants.length > 0 && (
        <optgroup label="Constants">
          {constants.map((constant) => (
            <option key={constant.path} value={`constant ${constant.path}`}>
              {constant.path}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function StepControls({ step, onChange }: { step: Step; onChange: (step: Step) => void }) {
  const { system, selector } = step;
  const forms = system.selector.forms ?? [];
  return (
    <>
      {system.selector.fields.map((field) => (
        <FieldControl
          key={field.name}
          field={field}
          value={selector[field.name]}
          inUse={inUse(system, field)}
          onChange={(part) => onChange({ ...step, selector: { ...selector, [field.name]: part } })}
        />
      ))}
      {forms.map((form) => (
        <label className="ref-control ref-control-check" key={form}>
          <span>{form}</span>
          <input
            type="checkbox"
            checked={selector.form === form}
            onChange={(event) => onChange({ ...step, selector: { ...selector, form: event.target.checked ? form : null } })}
          />
        </label>
      ))}
    </>
  );
}

function ConstantControls({ constant, onChange }: { constant: Constant; onChange: (constant: Constant) => void }) {
  return (
    <>
      <label className="ref-control ref-control-check">
        <span>transparent</span>
        <input
          type="checkbox"
          checked={constant.opacity != null}
          onChange={(event) => onChange({ ...constant, opacity: event.target.checked ? 50 : null })}
        />
      </label>
      {constant.opacity != null && (
        <NumberControl
          name="opacity"
          min={0}
          max={100}
          value={constant.opacity}
          inUse={[]}
          onChange={(opacity) => onChange({ ...constant, opacity })}
        />
      )}
    </>
  );
}

/** The values a number field already takes among the system's steps, to mark on its slider. */
function inUse(system: SnapshotSystem, field: SelectorField): number[] {
  if (field.kind !== "number") return [];
  const values = system.steps.flatMap((existing) => {
    try {
      const part = parseSelector(system.algorithm, system.selector, existing.selector).values[field.name];
      return typeof part === "number" ? [part] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(values)];
}

function FieldControl({
  field,
  value,
  inUse,
  onChange,
}: {
  field: SelectorField;
  value: Selector[string];
  inUse: number[];
  onChange: (value: number | string) => void;
}) {
  if (field.kind === "number") {
    return (
      <NumberControl name={field.name} min={field.min} max={field.max} value={Number(value)} inUse={inUse} onChange={onChange} />
    );
  }
  return (
    <label className="ref-control">
      <span>{field.name}</span>
      <select value={String(value)} onChange={(event) => onChange(event.target.value)}>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberControl({
  name,
  min,
  max,
  value,
  inUse,
  onChange,
}: {
  name: string;
  min: number;
  max: number;
  value: number;
  /** Values to mark on the slider. */
  inUse: number[];
  onChange: (value: number) => void;
}) {
  const marks = useId();
  const onNumber = (raw: string) => {
    const number = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(number) && number >= min && number <= max) onChange(number);
  };
  return (
    <label className="ref-control">
      <span>{name}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={SLIDER_STEP}
        list={marks}
        value={value}
        onChange={(event) => onNumber(event.target.value)}
      />
      <datalist id={marks}>
        {inUse.map((mark) => (
          <option key={mark} value={mark} />
        ))}
      </datalist>
      <input
        className="ref-number"
        type="number"
        min={min}
        max={max}
        step={SLIDER_STEP}
        value={value}
        onChange={(event) => onNumber(event.target.value)}
      />
    </label>
  );
}
