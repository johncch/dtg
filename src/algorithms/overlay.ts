import { assertKnownParams, type AlgorithmImpl } from "../contract.js";
import { assertHex, hexToRgb } from "../color-math.js";

/**
 * A color at selector % opacity, never flattened — the system's values are
 * overlays over whatever sits underneath (shadows, scrims).
 */
export const overlay: AlgorithmImpl = {
  description:
    "A color at selector % opacity, never flattened. For values that only exist over unknown content: shadows, scrims.",
  declaredSelectors(params) {
    assertKnownParams(params, ["color"], "overlay");
    return null;
  },

  resolveStep(params, selector) {
    const opacityPct = Number(selector);
    if (!Number.isFinite(opacityPct) || opacityPct < 0 || opacityPct > 100) {
      throw new Error(
        `overlay selector must be a number 0–100, got "${selector}"`,
      );
    }
    const [r, g, b] = hexToRgb(
      assertHex(params.color, "overlay param 'color'"),
    );
    return {
      css: `rgba(${r}, ${g}, ${b}, ${opacityPct / 100})`,
      opaque: false,
    };
  },
};
