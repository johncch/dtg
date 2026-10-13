import { formatColor, needsMapping, type Color } from "../src/color-math.js";

/**
 * The CSS to paint a color with. A color sRGB can hold is painted as its
 * sRGB value; one it cannot is painted in Display P3, so a wide screen shows
 * it at full strength instead of its sRGB fallback.
 */
export function paintCss(color: Color): string {
  return needsMapping(color, "srgb") ? formatColor(color, "display-p3") : formatColor(color, "srgb");
}
