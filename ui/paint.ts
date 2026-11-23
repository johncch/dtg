import { formatColor, isOpaque, needsMapping, type Color } from "../src/engine/color-math.js";
import { gradientCss } from "../src/engine/emit.js";
import type { ResolvedGradientRef } from "../src/engine/resolve.js";

/** What a swatch is filled with: a color, or a gradient of them. */
export type Paint = Color | ResolvedGradientRef;

export function isGradient(paint: Paint): paint is ResolvedGradientRef {
  return "stops" in paint;
}

/**
 * The CSS to paint with. A color sRGB can hold is painted as its sRGB value;
 * one it cannot is painted in Display P3, so a wide screen shows it at full
 * strength instead of its sRGB fallback. A gradient is painted stop by stop
 * the same way.
 */
export function paintCss(paint: Paint): string {
  if (isGradient(paint)) return gradientCss(paint, paint.stops.map((stop) => paintCss(stop.color.color)));
  return needsMapping(paint, "srgb") ? formatColor(paint, "display-p3") : formatColor(paint, "srgb");
}

export function paintIsOpaque(paint: Paint): boolean {
  return isGradient(paint) ? paint.stops.every((stop) => isOpaque(stop.color.color)) : isOpaque(paint);
}

/** One color to stand for the paint where only a color will do: a label's contrast, the picker's starting point. A gradient's is its first stop. */
export function leadColor(paint: Paint): Color {
  return isGradient(paint) ? paint.stops[0].color.color : paint;
}
