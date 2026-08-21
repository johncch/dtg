/**
 * What an algorithm returns: a colour as coordinates, not a string. The
 * string is chosen at emit, per target, so one value can be written as a hex
 * and as a P3 colour without either being a conversion of the other.
 */
export type StepValue = { color: Color };

/**
 * How a system wants to be shown and tuned. Structure, not markup — the
 * preview layer owns presentation, the algorithm owns what its params mean.
 */
import type { Color, Gamut } from "./color-math.js";

export type PreviewControl =
  | { kind: "color"; path: string; label: string; value: string }
  | {
      kind: "select";
      path: string;
      label: string;
      value: string;
      options: { value: string; label: string }[];
    }
  | {
      kind: "number";
      path: string;
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
      unit?: string;
    };

/** A knob that varies the selectors previewed, rather than a param. */
export type PreviewVar = {
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
};

export type AlgorithmPreview = {
  /**
   * `ramp` reads as a continuum, so neighbour deltas mean something.
   * `palette` is a set of unrelated entries, where they do not.
   */
  shape: "ramp" | "palette";
  controls: PreviewControl[];
  /**
   * Selectors to render together as one blended field, in order. A
   * `{name}` placeholder is filled from `vars`, so a preview can sweep a
   * coordinate the params do not hold.
   */
  composite?: { selectors: string[]; vars?: PreviewVar[] };
};

export type AlgorithmImpl = {
  /** One short paragraph explaining how this algorithm generates colors; rendered in the browsing UI. */
  description: string;
  /**
   * The selectors this system publishes regardless of demand (a public
   * palette), or null for demand-driven systems whose steps exist only
   * because refs ask for them.
   */
  declaredSelectors(params: Record<string, unknown>): string[] | null;
  /** Throws with a human message on an invalid selector or bad params. */
  resolveStep(params: Record<string, unknown>, selector: string): StepValue;
  /**
   * The colours this system was given. Only the algorithm knows which params
   * are colours. Absent = no check.
   */
  inputColors?(params: Record<string, unknown>): Color[];
  /**
   * The gamut this system's arithmetic runs in, or null when it has no fixed
   * one — because it widens to fit its inputs, or works in an unbounded space.
   * An input outside this gamut is clipped on the way in, whatever the steps
   * that happen to be demanded look like.
   */
  workingGamut?(params: Record<string, unknown>): Gamut | null;
  /**
   * The public name fragment this selector emits as. Absent = the default,
   * which suits decimal ramp coordinates. The core validates whatever comes
   * back: an algorithm proposes a name, it does not get to mint an illegal
   * one.
   */
  publicStep?(params: Record<string, unknown>, selector: string): string;
  /**
   * Sort key ordering this system's steps in emitted output and in the
   * strip. Absent = the default, which reads the selector as a number.
   * Need not be unique; the resolver tiebreaks on the raw selector so the
   * order is always total.
   */
  stepOrder?(
    params: Record<string, unknown>,
    selector: string,
  ): number | string;
  /**
   * Controls and shape for the browsing UI. Absent = the default ramp
   * rendering, which is what the built-in ramps want.
   */
  preview?(
    params: Record<string, unknown>,
    /** Selectors this system currently has steps for, for sensible defaults. */
    selectors: string[],
  ): AlgorithmPreview;
};

/** Read a dotted path out of a params object. */
export function paramAt(
  params: Record<string, unknown>,
  path: string,
): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        node != null && typeof node === "object"
          ? (node as Record<string, unknown>)[key]
          : undefined,
      params,
    );
}

/** Copy params with one dotted path replaced; the original is untouched. */
export function withParamAt(
  params: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split(".");
  const copy: Record<string, unknown> = { ...params };
  let node = copy;
  for (const key of keys.slice(0, -1)) {
    const child = node[key];
    if (child == null || typeof child !== "object") return copy;
    node[key] = { ...(child as Record<string, unknown>) };
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  return copy;
}

/** Dots become underscores: "5.5" → "5_5". */
export function defaultPublicStep(selector: string): string {
  return selector.replace(/\./g, "_");
}

export function defaultStepOrder(selector: string): number {
  return Number(selector);
}

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

/**
 * Reject typo'd params loudly: the pass-through grammar means an unknown key
 * would otherwise be silently ignored. Call from declaredSelectors so it
 * runs once per system.
 */
export function assertKnownParams(
  params: Record<string, unknown>,
  known: string[],
  algorithm: string,
): void {
  for (const key of Object.keys(params)) {
    if (!known.includes(key)) {
      throw new Error(
        `${algorithm}: unknown param "${key}" (known: ${known.join(", ")})`,
      );
    }
  }
}
