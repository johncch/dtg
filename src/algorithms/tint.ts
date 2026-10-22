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
    "A fixed tint composited over a base color. The selector is the tint's alpha in percent — `15` is 15% tint over the base, so the token name is the recipe. Adding `tint` — `15 tint` — gives the tint alone at the same alpha, without the base, for a value that has to sit over an unknown surface.",

  params: {
    base: { kind: "color" },
    tint: { kind: "color" },
  },

  selector: () => ({
    fields: [{ name: "percent", kind: "number", min: 0, max: 100 }],
    forms: ["tint"],
  }),

  resolve(selector, params) {
    const { base, tint } = params as { base: Color; tint: Color };
    const alpha = (selector.percent as number) / 100;
    if (selector.form === "tint") return { ...tint, alpha };
    return composite(tint, base, alpha, "srgb");
  },
};
