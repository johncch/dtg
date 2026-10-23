import { useId } from "react";
import type { Selector, SelectorField, SelectorShape } from "../../src/contract.js";
import { formatRef, formatSelector, parseCall, parseSelector } from "../../src/selector.js";
import type { SnapshotConstant, SnapshotSystem } from "../../src/snapshot.js";

export type Step = { kind: "step"; system: SnapshotSystem; selector: Selector };
/** `opacity` null is the constant itself; a number is it taken through transparent(). */
type Constant = { kind: "constant"; path: string; opacity: number | null };
export type Pointing = Step | Constant;

/** What the ref points at, or null when it is another role or does not read as a ref. */
export function pointingOf(ref: string, systems: SnapshotSystem[], constants: SnapshotConstant[]): Pointing | null {
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

export function refOf(pointing: Pointing): string {
  if (pointing.kind === "step") {
    return formatRef(pointing.system.system, formatSelector(pointing.system.selector, pointing.selector));
  }
  return pointing.opacity == null ? pointing.path : formatRef("transparent", `${pointing.path} ${pointing.opacity}`);
}

/** A selector for `shape` that keeps what it can of what the ref pointed at before. */
export function carriedOver(from: Pointing | null, shape: SelectorShape): Selector {
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

export function StepControls({ step, onChange }: { step: Step; onChange: (step: Step) => void }) {
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
