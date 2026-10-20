import type { Color } from "./color-math.js";
import type { CurveValue, Pivot } from "./curve-math.js";

/** What a param is. dtg validates against it and parses it before any hook runs. */
export type ParamKind =
  | { kind: "color" }
  /**
   * `min` and `max` bound the value; dtg rejects one outside them, and the app
   * offers a slider between them. An `optional` number with no default may be
   * left out, and the algorithm decides what that means.
   */
  | { kind: "number"; default?: number; min?: number; max?: number; optional?: boolean }
  | { kind: "choice"; options: string[]; default?: string }
  | { kind: "list"; of: ParamKind; length?: number; default?: unknown[] }
  | { kind: "map"; of: ParamKind }
  /**
   * One channel as `{ from, to, easing }`, running through a pivot the
   * algorithm's `curvePivots` supplies. It runs `along` one of the selector's
   * number fields, across that field's range, which is how a page can place
   * the system's steps on it. `min` and `max` bound `from` and `to`; a field
   * left out takes the default's. `label` says what the curve's values
   * measure and `unit` is written after them, for the page's axis.
   */
  | { kind: "curve"; along: string; min: number; max: number; default: CurveValue; label?: string; unit?: string };

/**
 * A system's params as the hooks receive them: every color already a
 * `Color`, every default filled in, nothing unknown or missing.
 */
export type Params = Record<string, unknown>;

/** A color among a system's params: `tint`, `toward.0`, `toward.red`. */
export type ColorParam = { path: string; color: Color };

export type SelectorField =
  | { name: string; kind: "number"; min: number; max: number }
  | { name: string; kind: "choice"; options: string[] };

/**
 * What a ref into this system is made of. The algorithm names the parts;
 * how they are written in a definition is dtg's, in `selector.ts`.
 */
export type SelectorShape = {
  /** In the order they are written. No field may be named `form`. */
  fields: SelectorField[];
  /** Other values the same selector can ask for, such as a layer before compositing. */
  forms?: string[];
};

/** One value per field, by field name, plus `form`: the form asked for, or null. */
export type Selector = Record<string, number | string | null>;

export type Algorithm = {
  /** What a system's `algorithm:` names. */
  name: string;
  /** One short paragraph explaining how this algorithm generates colors; rendered in the browsing UI. */
  description: string;
  params: Record<string, ParamKind>;
  /** Throws with a human message on params the kinds alone cannot rule out. */
  selector(params: Params): SelectorShape;
  /** Throws with a human message on a selector this system cannot produce. */
  resolve(selector: Selector, params: Params): Color;
  /** For each `curve` param, where it passes through what the algorithm holds fixed, so an editor can draw it. */
  curvePivots?(params: Params): Record<string, Pivot>;
  /**
   * What a value of a `curve` param looks like, for the editor to paint behind
   * the curve. Only the editor uses it; outputs come from `resolve` alone.
   */
  curveSwatch?(params: Params, name: string, value: number): Color;
};

/**
 * A step's public name lands in a CSS custom property and in a Figma
 * "system/step" path, so the legal set is narrower than either alone — a
 * "/" would silently nest a Figma group rather than fail.
 */
export function assertNameFragment(fragment: string, context: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(fragment)) {
    throw new Error(
      `${context}: "${fragment}" cannot be a public step name — only letters, digits, "_" and "-"`,
    );
  }
  return fragment;
}
