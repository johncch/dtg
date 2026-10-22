import type { Selector, SelectorShape } from "./contract.js";

/**
 * How a ref into a system is written in a definition: the system, then its
 * selector in parentheses — the fields in order, then a form, separated by
 * spaces: `sky(15)`, `sky(15 tint)`, `warm(red 6 alpha)`. Spaces, not commas:
 * a comma inside a `[ ]` list ends the item. This file is the only place
 * that knows; algorithms see the parsed values.
 */
/**
 * What a role writes for a mode that says nothing and takes the ref of the
 * mode it extends. Leaving the mode off the end of the list means the same.
 */
export const INHERIT = "~";

export function formatRef(system: string, selector: string): string {
  return `${system}(${selector})`;
}

/** A ref split into its system and selector, or null when it is not a call. */
export function parseCall(
  ref: string,
): { name: string; selector: string } | null {
  const call = /^([^\s()]+)\(([^()]*)\)$/.exec(ref);
  if (!call) return null;
  return { name: call[1], selector: wordsOf(call[2]).join(" ") };
}

function wordsOf(text: string): string[] {
  return text.trim() === "" ? [] : text.trim().split(/\s+/);
}

export type ParsedSelector = {
  /** Each field's value as it was written, in field order. */
  written: string[];
  values: Selector;
};

export function parseSelector(
  algorithm: string,
  shape: SelectorShape,
  text: string,
): ParsedSelector {
  const context = `${algorithm} selector "${text}"`;
  const words = wordsOf(text);
  const fieldNames = shape.fields.map((field) => field.name);
  if (words.length < fieldNames.length) {
    throw new Error(`${context}: expected ${fieldNames.join(" ")}`);
  }
  const written = words.slice(0, fieldNames.length);
  const extra = words.slice(fieldNames.length);
  const forms = shape.forms ?? [];
  if (extra.length > 1 || (extra.length === 1 && !forms.includes(extra[0]))) {
    throw new Error(
      `${context}: unknown form "${extra.join(" ")}" (known: ${forms.join(", ") || "none"})`,
    );
  }

  const values: Selector = { form: extra[0] ?? null };
  shape.fields.forEach((field, index) => {
    const part = written[index];
    if (field.kind === "choice") {
      if (!field.options.includes(part)) {
        throw new Error(
          `${context}: unknown ${field.name} "${part}" (declared: ${field.options.join(", ")})`,
        );
      }
      values[field.name] = part;
      return;
    }
    const number = Number(part);
    if (!Number.isFinite(number) || number < field.min || number > field.max) {
      throw new Error(
        `${context}: ${field.name} must be a number ${field.min}–${field.max}, got "${part}"`,
      );
    }
    values[field.name] = number;
  });
  return { written, values };
}

/** A selector as it would be written, from one value per field and a form. */
export function formatSelector(shape: SelectorShape, values: Selector): string {
  const words = shape.fields.map((field) => String(values[field.name]));
  if (values.form != null) words.push(String(values.form));
  return words.join(" ");
}

/**
 * The public name fragment a selector emits as: `3.5 tint` → `3_5-tint`.
 * Built from the text as written, never from the parsed number — a round
 * trip through a float turns "3.5" into "3.5000000000000004".
 */
export function publicStepOf(selector: ParsedSelector): string {
  const parts = selector.written.map((part) => part.replace(/\./g, "_"));
  if (selector.values.form != null) parts.push(String(selector.values.form));
  return parts.join("-");
}

/** Sort key for a system's steps: field by field, then the plain value before its forms. */
export function orderOf(shape: SelectorShape, selector: ParsedSelector): number[] {
  const order = shape.fields.map((field) => {
    const value = selector.values[field.name];
    return field.kind === "choice"
      ? field.options.indexOf(String(value))
      : Number(value);
  });
  const form = selector.values.form;
  order.push(form == null ? 0 : (shape.forms ?? []).indexOf(String(form)) + 1);
  return order;
}

/** How refs name a role: its groups and its name, dotted — just the name for one written straight in its section. */
export function rolePath(role: { group: string; role: string }): string {
  return role.group ? `${role.group}.${role.role}` : role.role;
}
