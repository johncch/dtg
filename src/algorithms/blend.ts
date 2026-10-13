import type { Algorithm } from "../contract.js";
import { mixIn, BLEND_SPACES } from "../color-math.js";
import type { BlendSpace, Color } from "../color-math.js";

type BlendParams = {
  base: Color;
  toward: Record<string, Color>;
  space: BlendSpace;
};

/**
 * One base color and several named colors to blend toward, at a weight
 * given per ref. This is CSS's own `color-mix(in <space>, a p%, b)` with N
 * second operands sharing one first — so `warm(red 6)` reads as six percent
 * of the way from base toward red.
 *
 * The space matters and is not a detail: the same two colors interpolated
 * in sRGB and OKLab land somewhere different, and only sRGB reproduces what
 * a browser or design tool would render.
 */
export const blend: Algorithm = {
  name: "blend",
  description:
    "A base color and several named colors to blend toward. The selector is a name and a weight — `red 6` is six percent of the way from the base toward red, `red 100` is red itself — so one palette serves tints and full strength. This is `color-mix(in <space>, red 6%, base)`; `space` chooses the interpolation space and defaults to srgb, which is what browsers and design tools do. Adding `alpha` — `red 6 alpha` — emits the toward color carrying the weight as opacity, for the browser to blend at render time.",

  params: {
    base: { kind: "color" },
    toward: { kind: "map", of: { kind: "color" } },
    space: {
      kind: "choice",
      options: BLEND_SPACES.map((space) => space.id),
      default: "srgb",
    },
  },

  preview: { shape: "palette" },

  selector: (params) => ({
    fields: [
      {
        name: "color",
        kind: "choice",
        options: Object.keys((params as BlendParams).toward),
      },
      { name: "weight", kind: "number", min: 0, max: 100 },
    ],
    forms: ["alpha"],
  }),

  workingGamut(params) {
    const { space } = params as BlendParams;
    if (space === "oklab") return null;
    return space.startsWith("display-p3") ? "display-p3" : "srgb";
  },

  resolve(selector, params) {
    const { base, toward, space } = params as BlendParams;
    const color = toward[selector.color as string];
    const weight = (selector.weight as number) / 100;
    if (selector.form === "alpha") {
      if (space !== "srgb") {
        throw new Error(
          `blend: the alpha form defers the blend to the browser, which always blends in srgb — this system blends in ${space}, so the two would disagree`,
        );
      }
      return { ...color, alpha: weight };
    }
    return mixIn(color, base, weight, space);
  },
};
