import { assertKnownParams, type AlgorithmImpl } from "../contract.js";
import {
  alphaComposite,
  channelsIn,
  colorFromRgb,
  parseColor,
  widestGamut,
} from "../color-math.js";

/**
 * An ink composited over a base; the selector is the ink's alpha as a
 * percentage (0–100). Steps are opaque surface colors; the unflattened
 * ink form backs transparent().
 */
export const inkRamp: AlgorithmImpl = {
  description:
    "A fixed ink composited over a base color. The selector is the ink's alpha in percent — `15` is 15% ink over the base, so the token name is the recipe. Adding `/ink` — `15/ink` — gives the same ink at the same alpha without the base, for a value that has to sit over an unknown surface.",
  declaredSelectors(params) {
    assertKnownParams(params, ["base", "ink"], "ink-ramp");
    parseColor(params.base, "ink-ramp param 'base'");
    parseColor(params.ink, "ink-ramp param 'ink'");
    return null;
  },

  resolveStep(params, selector) {
    const { alpha, inkOnly } = parse(selector);
    const ink = parseColor(params.ink, "ink-ramp param 'ink'");
    if (inkOnly) return { color: { ...ink, alpha } };
    const base = parseColor(params.base, "ink-ramp param 'base'");
    const gamut = widestGamut([ink, base]);
    return {
      color: colorFromRgb(
        alphaComposite(channelsIn(ink, gamut), channelsIn(base, gamut), alpha),
        gamut,
      ),
    };
  },

  inputColors(params) {
    return [
      parseColor(params.base, "ink-ramp param 'base'"),
      parseColor(params.ink, "ink-ramp param 'ink'"),
    ];
  },

  publicStep(_params, selector) {
    // Derived from the selector text, never from the parsed float — a
    // round-trip through alpha turns "3.5" into "3.5000000000000004".
    const { head, inkOnly } = split(selector);
    parseAlpha(head);
    return `${head.replace(/\./g, "_")}${inkOnly ? "-ink" : ""}`;
  },

  stepOrder(_params, selector) {
    const { alpha, inkOnly } = parse(selector);
    // Alpha first, then the composited form before the ink-only one.
    return `${(alpha * 100).toFixed(4).padStart(9, "0")}:${inkOnly ? "1" : "0"}`;
  },
};

function split(selector: string): { head: string; inkOnly: boolean } {
  const slash = selector.indexOf("/");
  if (slash === -1) return { head: selector, inkOnly: false };
  const suffix = selector.slice(slash + 1);
  if (suffix !== "ink") {
    throw new Error(
      `ink-ramp selector "${selector}": unknown form "${suffix}" (known: ink)`,
    );
  }
  return { head: selector.slice(0, slash), inkOnly: true };
}

function parse(selector: string): { alpha: number; inkOnly: boolean } {
  const { head, inkOnly } = split(selector);
  return { alpha: parseAlpha(head), inkOnly };
}

function parseAlpha(selector: string): number {
  const alphaPct = Number(selector);
  if (!Number.isFinite(alphaPct) || alphaPct < 0 || alphaPct > 100) {
    throw new Error(
      `ink-ramp selector must be a number 0–100, got "${selector}"`,
    );
  }
  return alphaPct / 100;
}
