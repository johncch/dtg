import type { Color, Gamut } from "./color-math.js";

/** What a param is. dtg validates against it and parses it before any hook runs. */
export type ParamKind =
  | { kind: "color" }
  | { kind: "number"; default?: number }
  | { kind: "choice"; options: string[]; default?: string }
  | { kind: "list"; of: ParamKind; length?: number }
  | { kind: "map"; of: ParamKind };

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
  /**
   * Which of a system's steps are written out. `demanded` = only the steps
   * refs ask for. `all` = every option of its selector's fields whether or
   * not a ref asks — a public palette; every field must then be a choice.
   * Absent = demanded.
   */
  emit?: "all" | "demanded";
  /**
   * `ramp` reads as a continuum, so neighbor deltas mean something.
   * `palette` is a set of unrelated entries, where they do not. Absent = ramp.
   */
  preview?: { shape: "ramp" | "palette" };
  /** Throws with a human message on params the kinds alone cannot rule out. */
  selector(params: Params): SelectorShape;
  /**
   * The gamut this system's arithmetic runs in, or null when it has no fixed
   * one — because it widens to fit its inputs, or works in an unbounded space.
   * An input outside this gamut is clipped on the way in, whatever the steps
   * that happen to be demanded look like. Absent = null.
   */
  workingGamut?(params: Params): Gamut | null;
  /** Throws with a human message on a selector this system cannot produce. */
  resolve(selector: Selector, params: Params): Color;
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
