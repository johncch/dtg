import type { Algorithm } from "../contract.js";
import {
  baseHueOf,
  channelsIn,
  colorFromRgb,
  oklchInterpolate,
  widestGamut,
  type Color,
} from "../color-math.js";

type OklchScaleParams = {
  base: Color;
  toward: [Color, Color];
  hueShift: number;
  stops: Record<string, number>;
};

/**
 * A chromatic scale blended from a base color toward two targets in OKLCH.
 * `stops` maps stop names to the fraction of base in the blend (1 = the
 * base itself). Stop names are numeric: below 500 blends toward
 * `toward[0]` (the light side), above 500 toward `toward[1]` (the dark
 * side). All stops are declared — the scale is a public palette.
 */
export const scale: Algorithm = {
  name: "scale",
  description:
    "A chromatic scale blended from the 500 base color in OKLCH. Stops below 500 blend toward the light target, stops above 500 toward the dark target; each stop's value is the fraction of base remaining in the blend. Hue is held near the base hue — hueShift 0 locks it entirely, 100 follows the natural interpolated path.",

  params: {
    base: { kind: "color" },
    toward: { kind: "list", of: { kind: "color" }, length: 2 },
    hueShift: { kind: "number", default: 0 },
    stops: { kind: "map", of: { kind: "number" } },
  },

  emit: "all",

  selector(params) {
    const stops = Object.keys((params as OklchScaleParams).stops);
    for (const stop of stops) {
      if (!Number.isFinite(Number(stop))) {
        throw new Error(
          `scale stop names must be numeric, got "${stop}"`,
        );
      }
    }
    return { fields: [{ name: "stop", kind: "choice", options: stops }] };
  },

  resolve(selector, params) {
    const { base, toward, hueShift, stops } = params as OklchScaleParams;
    const stop = selector.stop as string;
    const baseFraction = stops[stop];
    if (baseFraction === 1) return base;

    const [light, dark] = toward;
    const gamut = widestGamut([base, light, dark]);
    const baseChannels = channelsIn(base, gamut);
    const baseHue = baseHueOf(baseChannels);
    const rgb =
      Number(stop) < 500
        ? oklchInterpolate(
            channelsIn(light, gamut),
            baseChannels,
            baseFraction,
            baseHue,
            hueShift,
          )
        : oklchInterpolate(
            baseChannels,
            channelsIn(dark, gamut),
            1 - baseFraction,
            baseHue,
            hueShift,
          );
    return colorFromRgb(rgb, gamut);
  },
};
