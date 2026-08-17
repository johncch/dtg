import { assertKnownParams, type AlgorithmImpl } from "../contract.js";
import {
  alphaComposite,
  assertHex,
  hexToRgb,
  rgbToHex,
} from "../color-math.js";

/**
 * An ink composited over a base; the selector is the ink's alpha as a
 * percentage (0–100). Steps are opaque surface colors; the unflattened
 * ink form backs transparent().
 */
export const inkRamp: AlgorithmImpl = {
  description:
    "A fixed ink composited over a base color. The selector is the ink's alpha in percent — step 15 is 15% ink over the base, so the token name is the recipe. transparent() returns the same step unflattened: the ink itself at that alpha.",
  declaredSelectors(params) {
    assertKnownParams(params, ["base", "ink"], "ink-ramp");
    return null;
  },

  resolveStep(params, selector) {
    const ink = hexToRgb(assertHex(params.ink, "ink-ramp param 'ink'"));
    const base = hexToRgb(assertHex(params.base, "ink-ramp param 'base'"));
    return {
      css: rgbToHex(alphaComposite(ink, base, parseAlpha(selector))),
      opaque: true,
    };
  },

  resolveTranslucent(params, selector) {
    const ink = hexToRgb(assertHex(params.ink, "ink-ramp param 'ink'"));
    return `rgba(${ink[0]}, ${ink[1]}, ${ink[2]}, ${parseAlpha(selector)})`;
  },
};

function parseAlpha(selector: string): number {
  const alphaPct = Number(selector);
  if (!Number.isFinite(alphaPct) || alphaPct < 0 || alphaPct > 100) {
    throw new Error(
      `ink-ramp selector must be a number 0–100, got "${selector}"`,
    );
  }
  return alphaPct / 100;
}
