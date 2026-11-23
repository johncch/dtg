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
    "A ramp where the step is lightness itself, from 0 (black) to 100 (white), so the same step is equally light in every hue, as in Material 3.",

  profile: ["cielab.l", "oklch.c", "oklch.h"],

  params: {
    anchor: { kind: "color", description: "Lends its hue, and its chroma unless chroma is set." },
    chroma: { kind: "number", optional: true, min: 0, max: 0.4, description: "How colorful the ramp is, the same at every step. Defaults to the anchor's chroma." },
    hue: { kind: "number", default: 0, min: -180, max: 180, description: "Degrees added to the anchor's hue." },
    gamut: {
      kind: "choice",
      options: ["srgb", "display-p3"],
      default: "srgb",
      description: "The color space the colors can be produced in.",
    },
  },

  selector: () => ({
    fields: [{ name: "tone", kind: "number", min: 0, max: 100, description: "How light the step is, from 0 (black) to 100 (white)." }],
  }),

  resolve(selector, params) {
    const p = params as ToneParams;
    const anchor = toOklab(p.anchor);
    const chroma = p.chroma ?? oklabToOklch(anchor)[1];
    const hue = (hueOf(p.anchor) ?? 0) + p.hue;
    return colorFromOklab(colorAtTone(selector.tone as number, chroma, hue, p.gamut));
  },
};
