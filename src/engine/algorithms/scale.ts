import type { Algorithm } from "../contract.js";
import { blendOklch, hueOf, type Color } from "../color-math.js";

type OklchScaleParams = {
  base: Color;
  toward: [Color, Color];
  /** Light half, dark half. */
  hueShift: [number, number];
  midpoint: [number, number];
};

/**
 * A chromatic scale from a light target through the base to a dark target,
 * blended in OKLCH. The selector is a position 0–1000: 0 is `toward[0]`,
 * 500 the base, 1000 `toward[1]`. How much of the base a position carries
 * follows a curve whose shape `midpoint` sets: the share of base at 250 for
 * the light half and at 750 for the dark half. 0.5 is a straight line.
 * `hueShift` and `midpoint` are each one number for both halves, or a pair
 * in `toward`'s order.
 */
export const scale: Algorithm = {
  name: "scale",
  description:
    "A light-to-dark ramp through a base color, blended toward two end colors you pick. The step is a stop from 0 to 1000, with the base at 500.",

  params: {
    base: { kind: "color", description: "The color at stop 500." },
    toward: { kind: "list", of: { kind: "color" }, length: 2, description: "The colors at stop 0 and stop 1000." },
    hueShift: {
      kind: "number",
      default: 0,
      min: 0,
      max: 100,
      ends: 2,
      description: "How far hue moves from the base's toward each end's, from 0 (held) to 100 (all the way).",
    },
    midpoint: {
      kind: "number",
      default: 0.5,
      min: 0,
      max: 1,
      ends: 2,
      description: "How much of the base the steps halfway to each end keep. 0.5 is a straight line; higher keeps the base longer.",
    },
  },

  selector(params) {
    const { midpoint } = params as OklchScaleParams;
    for (const half of midpoint) {
      if (!(half > 0 && half < 1)) {
        throw new Error(`midpoint must be between 0 and 1, got ${half}`);
      }
    }
    return {
      fields: [
        {
          name: "stop",
          kind: "number",
          min: 0,
          max: 1000,
          description: "Where on the ramp, from the light end at 0 to the dark end at 1000. The base is at 500.",
        },
      ],
    };
  },

  resolve(selector, params) {
    const { base, toward, hueShift, midpoint } = params as OklchScaleParams;
    const stop = selector.stop as number;
    if (stop === 500) return base;

    const half = stop < 500 ? 0 : 1;
    const fromEnd = half === 0 ? stop / 500 : (1000 - stop) / 500;
    const baseFraction = fromEnd ** (Math.log(midpoint[half]) / Math.log(0.5));
    const end = toward[half];
    const heldHue = hueOf(base) ?? hueOf(end) ?? 0;
    return half === 0
      ? blendOklch(toward[0], base, baseFraction, heldHue, hueShift[0])
      : blendOklch(base, toward[1], 1 - baseFraction, heldHue, hueShift[1]);
  },
};
