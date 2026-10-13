import type { Algorithm } from "../contract.js";
import type { Color } from "../color-math.js";

/**
 * A color at selector % opacity, never flattened — the system's values are
 * overlays over whatever sits underneath (shadows, scrims).
 */
export const overlay: Algorithm = {
  name: "overlay",
  description:
    "A color at selector % opacity, never flattened. For values that only exist over unknown content: shadows, scrims.",

  params: {
    color: { kind: "color" },
  },

  selector: () => ({
    fields: [{ name: "opacity", kind: "number", min: 0, max: 100 }],
  }),

  resolve(selector, params) {
    const { color } = params as { color: Color };
    return { ...color, alpha: (selector.opacity as number) / 100 };
  },
};
