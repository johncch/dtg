export type StepValue = {
  /** CSS-ready color: a hex for surface systems, an rgba() for overlays. */
  css: string;
  opaque: boolean;
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
   * The step's unflattened form (ink at the step's alpha), backing the
   * transparent() expression. Absent = the system has nothing to unflatten.
   */
  resolveTranslucent?(
    params: Record<string, unknown>,
    selector: string,
  ): string;
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
};

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
