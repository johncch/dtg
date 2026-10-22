import type { Algorithm } from "../contract.js";
import { blendOklch, hueOf, type Color } from "../color-math.js";

type OklchScaleParams = {
  base: Color;
  toward: [Color, Color];
  hueShift: number;
  midpoint: number;
};

/**
 * A chromatic scale from a light target through the base to a dark target,
 * blended in OKLCH. The selector is a position 0–1000: 0 is `toward[0]`,
 * 500 the base, 1000 `toward[1]`. How much of the base a position carries
 * follows one curve, mirrored about 500, whose shape `midpoint` sets: the
 * share of base at 250 (and 750). 0.5 is a straight line.
 */
export const scale: Algorithm = {
  name: "scale",
  description:
    "A chromatic scale through the base color in OKLCH. The selector is a position from 0 to 1000: 0 is the light target, 500 the base, 1000 the dark target. midpoint is how much of the base shows at 250 and 750 — 0.5 is an even line, lower keeps the ends paler and deeper for longer. Hue is held near the base hue — hueShift 0 locks it entirely, 100 follows the natural interpolated path.",

  params: {
    base: { kind: "color" },
    toward: { kind: "list", of: { kind: "color" }, length: 2 },
    hueShift: { kind: "number", default: 0, min: 0, max: 100 },
    midpoint: { kind: "number", default: 0.5, min: 0, max: 1 },
  },

  selector(params) {
    const { midpoint } = params as OklchScaleParams;
    if (!(midpoint > 0 && midpoint < 1)) {
      throw new Error(`midpoint must be between 0 and 1, got ${midpoint}`);
    }
    return { fields: [{ name: "stop", kind: "number", min: 0, max: 1000 }] };
  },

  resolve(selector, params) {
    const { base, toward, hueShift, midpoint } = params as OklchScaleParams;
    const stop = selector.stop as number;
    if (stop === 500) return base;

    const fromEnd = stop < 500 ? stop / 500 : (1000 - stop) / 500;
    const baseFraction = fromEnd ** (Math.log(midpoint) / Math.log(0.5));
    const [light, dark] = toward;
    const end = stop < 500 ? light : dark;
    const heldHue = hueOf(base) ?? hueOf(end) ?? 0;
    return stop < 500
      ? blendOklch(light, base, baseFraction, heldHue, hueShift)
      : blendOklch(base, dark, 1 - baseFraction, heldHue, hueShift);
  },
};
