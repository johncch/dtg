import type { Algorithm } from "../contract.js";
import { colorAtTone, colorFromOklab, hueOf, oklabToOklch, toOklab, type Color, type Gamut } from "../color-math.js";

type ToneParams = {
  anchor: Color;
  chroma?: number;
  hue: number;
  gamut: Gamut;
};

/**
 * A palette whose selector is tone, CIELAB L*: every palette's 40 is equally
 * light, so a tone difference carries a known contrast. The anchor lends its
 * OKLCH hue and, unless `chroma` says otherwise, its chroma.
 */
export const tone: Algorithm = {
  name: "tone",
  description:
    "Experimental. A light-to-dark ramp where the same step is equally light in every hue, as in Material 3.",

  params: {
    anchor: { kind: "color" },
    chroma: { kind: "number", optional: true, min: 0, max: 0.4 },
    hue: { kind: "number", default: 0, min: -180, max: 180 },
    gamut: { kind: "choice", options: ["srgb", "display-p3"], default: "srgb" },
  },

  selector: () => ({ fields: [{ name: "tone", kind: "number", min: 0, max: 100 }] }),

  resolve(selector, params) {
    const p = params as ToneParams;
    const anchor = toOklab(p.anchor);
    const chroma = p.chroma ?? oklabToOklch(anchor)[1];
    const hue = (hueOf(p.anchor) ?? 0) + p.hue;
    return colorFromOklab(colorAtTone(selector.tone as number, chroma, hue, p.gamut));
  },
};
