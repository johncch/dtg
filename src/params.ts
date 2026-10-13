import { parseColor } from "./color-math.js";
import type { Algorithm, ColorParam, ParamKind, Params } from "./contract.js";

export type ParsedParams = {
  values: Params;
  /** Every color among them, with the dotted path it was written at. */
  colors: ColorParam[];
};

/**
 * A system's params checked against what its algorithm declares, and parsed.
 * Throws on the first unknown, missing or malformed param.
 */
export function parseParams(
  algorithm: Algorithm,
  written: Record<string, unknown>,
): ParsedParams {
  const known = Object.keys(algorithm.params);
  for (const key of Object.keys(written)) {
    if (!known.includes(key)) {
      throw new Error(
        `${algorithm.name}: unknown param "${key}" (known: ${known.join(", ")})`,
      );
    }
  }

  const colors: ColorParam[] = [];

  function parseValue(kind: ParamKind, value: unknown, path: string): unknown {
    const context = `${algorithm.name} param '${path}'`;
    switch (kind.kind) {
      case "color": {
        const color = parseColor(value, context);
        colors.push({ path, color });
        return color;
      }
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(
            `${context}: expected a number, got ${JSON.stringify(value)}`,
          );
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
    } else {
      throw new Error(`${algorithm.name}: missing param "${key}"`);
    }
  }
  return { values, colors };
}
