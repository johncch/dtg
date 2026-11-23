import type { Algorithm } from "../contract.js";
import { composite, type Color } from "../color-math.js";

/**
 * A tint composited over a base; the selector is the tint's alpha as a
 * percentage (0–100). Steps are opaque surface colors; the `tint` form is
 * the same tint at the same alpha, left unflattened.
 */
export const tint: Algorithm = {
  name: "tint",
  description:
    "A tint color laid over a base and flattened to a solid color. The step is the tint's percent.",

  params: {
    base: { kind: "color", description: "The background the tint is laid over." },
    tint: { kind: "color", description: "The color laid over the base." },
  },

  selector: () => ({
    fields: [{ name: "percent", kind: "number", min: 0, max: 100, description: "How much of the tint is laid over the base, from 0 to 100." }],
    forms: ["tint"],
    formDescriptions: { tint: "Use only the tint color, see-through instead of mixed with the base." },
  }),

  resolve(selector, params) {
    const { base, tint } = params as { base: Color; tint: Color };
    const alpha = (selector.percent as number) / 100;
    if (selector.form === "tint") return { ...tint, alpha };
    return composite(tint, base, alpha, "srgb");
  },
};
