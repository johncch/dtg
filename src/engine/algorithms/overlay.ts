import type { Algorithm } from "../contract.js";
import type { Color } from "../color-math.js";

/**
 * A color at selector % opacity, never flattened — the system's values are
 * overlays over whatever sits underneath (shadows, scrims).
 */
export const overlay: Algorithm = {
  name: "overlay",
  description:
    "One color at a range of opacities, never flattened, for shadows and scrims over content you don't control. The step is the opacity.",

  profile: ["alpha"],

  params: {
    color: { kind: "color", description: "The color, at the step's opacity." },
  },

  selector: () => ({
    fields: [{ name: "opacity", kind: "number", min: 0, max: 100, description: "How opaque the color is, from 0 to 100." }],
  }),

  resolve(selector, params) {
    const { color } = params as { color: Color };
    return { ...color, alpha: (selector.opacity as number) / 100 };
  },
};
