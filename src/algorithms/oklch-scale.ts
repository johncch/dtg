import { assertKnownParams, type AlgorithmImpl } from "../contract.js";
import {
  baseHueOf,
  channelsIn,
  colorFromRgb,
  oklchInterpolate,
  parseColor,
  widestGamut,
} from "../color-math.js";

/**
 * A chromatic scale blended from a base color toward two targets in OKLCH.
 * `stops` maps stop names to the fraction of base in the blend (1 = the
 * base itself). Stop names are numeric: below 500 blends toward
 * `toward[0]` (the light side), above 500 toward `toward[1]` (the dark
 * side). All stops are declared — the scale is a public palette.
 */
export const oklchScale: AlgorithmImpl = {
  description:
    "A chromatic scale blended from the 500 base color in OKLCH. Stops below 500 blend toward the light target, stops above 500 toward the dark target; each stop's value is the fraction of base remaining in the blend. Hue is held near the base hue — hueShift 0 locks it entirely, 100 follows the natural interpolated path.",
  declaredSelectors(params) {
    assertKnownParams(
      params,
      ["base", "toward", "hueShift", "stops"],
      "oklch-scale",
    );
    return Object.keys(stopsOf(params));
  },

  resolveStep(params, selector) {
    const stops = stopsOf(params);
    const t = stops[selector];
    if (t == null) {
      throw new Error(
        `oklch-scale has no stop "${selector}" (declared: ${Object.keys(stops).join(", ")})`,
      );
    }
    const baseColor = parseColor(params.base, "oklch-scale param 'base'");
    if (t === 1) return { color: baseColor };

    const toward = params.toward;
    if (!Array.isArray(toward) || toward.length !== 2) {
      throw new Error(
        "oklch-scale param 'toward' must be [lightTarget, darkTarget]",
      );
    }
    const light = parseColor(toward[0], "oklch-scale param 'toward[0]'");
    const dark = parseColor(toward[1], "oklch-scale param 'toward[1]'");
    const gamut = widestGamut([baseColor, light, dark]);
    const base = channelsIn(baseColor, gamut);
    const hueShift = Number(params.hueShift ?? 0);
    const stopNumber = Number(selector);
    if (!Number.isFinite(stopNumber)) {
      throw new Error(
        `oklch-scale stop names must be numeric, got "${selector}"`,
      );
    }
    const baseHue = baseHueOf(base);
    const rgb =
      stopNumber < 500
        ? oklchInterpolate(channelsIn(light, gamut), base, t, baseHue, hueShift)
        : oklchInterpolate(
            base,
            channelsIn(dark, gamut),
            1 - t,
            baseHue,
            hueShift,
          );
    return { color: colorFromRgb(rgb, gamut) };
  },
};

function stopsOf(params: Record<string, unknown>): Record<string, number> {
  const stops = params.stops;
  if (stops == null || typeof stops !== "object" || Array.isArray(stops)) {
    throw new Error(
      "oklch-scale param 'stops' must be a map of stop name → base fraction",
    );
  }
  return stops as Record<string, number>;
}
