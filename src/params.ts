import { parseColor, type Color } from "./color-math.js";
import type { Algorithm, ColorParam, ParamKind, Params } from "./contract.js";
import type { CurveValue, Ease } from "./curve-math.js";

/** A color param, and the constant it names when it names one rather than writing a color. */
export type ParsedColorParam = ColorParam & { constant: string | null };

export type ParsedParams = {
  values: Params;
  /** Every color among them, with the dotted path it was written at. */
  colors: ParsedColorParam[];
};

/**
 * A system's params checked against what its algorithm declares, and parsed.
 * Throws on the first unknown, missing or malformed param.
 */
export function parseParams(
  algorithm: Algorithm,
  written: Record<string, unknown>,
  constants: ReadonlyMap<string, Color> = new Map(),
): ParsedParams {
  const known = Object.keys(algorithm.params);
  for (const key of Object.keys(written)) {
    if (!known.includes(key)) {
      throw new Error(
        `${algorithm.name}: unknown param "${key}" (known: ${known.join(", ")})`,
      );
    }
  }

  const colors: ParsedColorParam[] = [];

  function parseValue(kind: ParamKind, value: unknown, path: string): unknown {
    const context = `${algorithm.name} param '${path}'`;
    switch (kind.kind) {
      case "color": {
        const named = typeof value === "string" ? constants.get(value) : undefined;
        if (named) {
          colors.push({ path, color: named, constant: value as string });
          return named;
        }
        if (typeof value === "string" && /^[A-Za-z][\w-]*(\.[A-Za-z][\w-]*)*$/.test(value)) {
          throw new Error(`${context}: no constant "${value}" (a color param is a color, or the path of a constant)`);
        }
        const color = parseColor(value, context);
        colors.push({ path, color, constant: null });
        return color;
      }
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(
            `${context}: expected a number, got ${JSON.stringify(value)}`,
          );
        }
        if ((kind.min != null && value < kind.min) || (kind.max != null && value > kind.max)) {
          throw new Error(`${context}: expected ${kind.min ?? "-∞"}–${kind.max ?? "∞"}, got ${value}`);
        }
        return value;
      case "choice":
        if (typeof value !== "string" || !kind.options.includes(value)) {
          throw new Error(
            `${context}: expected one of ${kind.options.join(", ")}, got ${JSON.stringify(value)}`,
          );
        }
        return value;
      case "list":
        if (!Array.isArray(value)) {
          throw new Error(`${context}: expected a list`);
        }
        if (kind.length != null && value.length !== kind.length) {
          throw new Error(
            `${context}: expected ${kind.length} items, got ${value.length}`,
          );
        }
        return value.map((item, index) =>
          parseValue(kind.of, item, `${path}.${index}`),
        );
      case "curve":
        return parseCurve(kind, value, context);
      case "map":
        if (value == null || typeof value !== "object" || Array.isArray(value)) {
          throw new Error(`${context}: expected a map`);
        }
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            parseValue(kind.of, item, `${path}.${key}`),
          ]),
        );
    }
  }

  const values: Params = {};
  for (const [key, kind] of Object.entries(algorithm.params)) {
    const value = written[key];
    if (value != null) {
      values[key] = parseValue(kind, value, key);
    } else if ("default" in kind && kind.default !== undefined) {
      values[key] = kind.default;
    } else if (kind.kind === "number" && kind.optional) {
      continue;
    } else {
      throw new Error(`${algorithm.name}: missing param "${key}"`);
    }
  }
  return { values, colors };
}

/** `{ from, to, easing }`, each field optional and defaulted, nothing else. */
function parseCurve(kind: Extract<ParamKind, { kind: "curve" }>, value: unknown, context: string): CurveValue {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context}: expected a curve, { from, to, easing }`);
  }
  const written = value as Record<string, unknown>;
  for (const key of Object.keys(written)) {
    if (!["from", "to", "easing"].includes(key)) {
      throw new Error(`${context}: unknown field "${key}" (a curve has from, to and easing)`);
    }
  }
  const end = (field: "from" | "to"): number => {
    const n = written[field] ?? kind.default[field];
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error(`${context}.${field}: expected a number, got ${JSON.stringify(n)}`);
    }
    if (n < kind.min || n > kind.max) {
      throw new Error(`${context}.${field}: expected ${kind.min}–${kind.max}, got ${n}`);
    }
    return n;
  };
  const easing = written.easing ?? kind.default.easing;
  const sides = ["before the pivot", "after it"];
  if (!Array.isArray(easing) || easing.length !== 2) {
    throw new Error(`${context}.easing: expected two cubic-bezier lists, ${sides.join(" and ")}`);
  }
  for (const [side, ease] of easing.entries()) {
    if (!Array.isArray(ease) || ease.length !== 4 || ease.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error(`${context}.easing, ${sides[side]}: expected four numbers, as in CSS cubic-bezier(), got ${JSON.stringify(ease)}`);
    }
    if (ease[0] < 0 || ease[0] > 1 || ease[2] < 0 || ease[2] > 1) {
      throw new Error(`${context}.easing, ${sides[side]}: x values must be 0–1, as in CSS cubic-bezier(); got [${ease.join(", ")}]`);
    }
  }
  return { from: end("from"), to: end("to"), easing: easing as [Ease, Ease] };
}
