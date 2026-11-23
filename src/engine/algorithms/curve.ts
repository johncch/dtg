import type { Algorithm } from "../contract.js";
import {
  colorFromOklab,
  hueOf,
  maxChroma,
  oklabToOklch,
  oklchToOklab,
  toOklab,
  type Color,
  type Gamut,
} from "../color-math.js";
import { curveAt, LINEAR, type CurveValue, type Pivot, type Span } from "../curve-math.js";

type CurveParams = {
  anchor: Color;
  at: number;
  gamut: Gamut;
  lightness: CurveValue;
  chroma: CurveValue;
  hue: CurveValue;
};

const straight = (from: number, to: number): CurveValue => ({ from, to, easing: [LINEAR, LINEAR] });
const STOPS: Span = { min: 0, max: 1000 };

/**
 * A ramp through a picked color. The selector is a position 0–1000; the
 * anchor sits at `at`. Lightness, chroma (as a share of the gamut's maximum)
 * and hue (degrees from the anchor's) are each a curve from `from` through
 * the anchor's value to `to`.
 */
export const curve: Algorithm = {
  name: "curve",
  description:
    "A light-to-dark ramp through one color, with lightness, chroma and hue each shaped by a curve you draw. The step is a stop from 0 to 1000, with the color at 500 unless the at param moves it.",

  params: {
    anchor: { kind: "color", description: "The color the ramp passes through." },
    at: { kind: "number", default: 500, min: 1, max: 999, description: "The stop the anchor sits at." },
    gamut: {
      kind: "choice",
      options: ["srgb", "display-p3"],
      default: "display-p3",
      description: "The color space the colors are made to fit.",
    },
    lightness: {
      kind: "curve",
      along: "stop",
      min: 0,
      max: 1,
      label: "OKLab lightness",
      default: straight(0.97, 0.25),
      description: "OKLab lightness at stop 0 and stop 1000, passing through the anchor's.",
    },
    chroma: {
      kind: "curve",
      along: "stop",
      min: 0,
      max: 1.5,
      label: "share of the gamut's maximum chroma",
      default: straight(0.4, 0.7),
      description: "Chroma as a share of the most the gamut holds, at stop 0 and stop 1000.",
    },
    hue: {
      kind: "curve",
      along: "stop",
      min: -180,
      max: 180,
      label: "degrees from the anchor's hue",
      unit: "°",
      default: straight(0, 0),
      description: "Degrees from the anchor's hue, at stop 0 and stop 1000.",
    },
  },

  selector: () => ({
    fields: [{ name: "stop", kind: "number", ...STOPS, description: "Where on the ramp, from 0 to 1000. The anchor sits where the at param puts it." }],
  }),

  resolve(selector, params) {
    const p = params as CurveParams;
    const stop = selector.stop as number;
    if (stop === p.at) return p.anchor;
    const pivots = pivotsOf(p);
    const anchorHue = hueOf(p.anchor) ?? 0;
    const lightness = Math.min(1, Math.max(0, curveAt(p.lightness, pivots.lightness, stop, STOPS)));
    const hue = anchorHue + curveAt(p.hue, pivots.hue, stop, STOPS);
    const share = Math.max(0, curveAt(p.chroma, pivots.chroma, stop, STOPS));
    return colorFromOklab(oklchToOklab([lightness, share * maxChroma(lightness, hue, p.gamut), hue]));
  },

  curvePivots: (params) => pivotsOf(params as CurveParams),

  /** The anchor with one channel moved to `value`, the others held at the anchor's. */
  curveSwatch(params, name, value) {
    const p = params as CurveParams;
    const anchor = pivotsOf(p);
    const anchorHue = hueOf(p.anchor) ?? 0;
    const lightness = name === "lightness" ? Math.min(1, Math.max(0, value)) : anchor.lightness.value;
    const hue = name === "hue" ? anchorHue + value : anchorHue;
    const share = name === "chroma" ? Math.max(0, value) : anchor.chroma.value;
    return colorFromOklab(oklchToOklab([lightness, share * maxChroma(lightness, hue, p.gamut), hue]));
  },
};

/** Each channel passes through the anchor: its lightness, its chroma as a share of the gamut's maximum, and hue offset 0. */
function pivotsOf(p: CurveParams): Record<"lightness" | "chroma" | "hue", Pivot> {
  const [lightness, chroma] = oklabToOklch(toOklab(p.anchor));
  const room = maxChroma(lightness, hueOf(p.anchor) ?? 0, p.gamut);
  return {
    lightness: { at: p.at, value: lightness },
    chroma: { at: p.at, value: room > 0 ? chroma / room : 0 },
    hue: { at: p.at, value: 0 },
  };
}
