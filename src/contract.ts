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
};

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
