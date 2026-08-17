export type Rgb = [number, number, number];

export function assertHex(value: unknown, context: string): string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(
      `${context}: expected a 6-digit hex color, got ${JSON.stringify(value)}`,
    );
  }
  return value.toLowerCase();
}

export function hexToRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function rgbToHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((c) =>
        Math.max(0, Math.min(255, Math.round(c)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function alphaComposite(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((f, i) => alpha * f + (1 - alpha) * bg[i]) as Rgb;
}

function srgbToLinear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
}

function linearRgbToOklab([r, g, b]: Rgb): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function rgbToOklch(rgb: Rgb): [number, number, number] {
  const [L, a, b] = linearRgbToOklab(rgb.map(srgbToLinear) as Rgb);
  return [
    L,
    Math.hypot(a, b),
    ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  ];
}

function oklchToRgb([L, C, h]: [number, number, number]): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  return oklabToLinearRgb([L, a, b]).map(linearToSrgb) as Rgb;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  let r = a + t * d;
  if (r < 0) r += 360;
  if (r >= 360) r -= 360;
  return r;
}

/**
 * Blend `from` → `to` at t in OKLCH. L and C interpolate linearly; hue is
 * held at `baseHue`, allowed to drift hueShift% of the way toward the
 * natural interpolated hue. A near-neutral endpoint has no meaningful hue
 * angle (float noise), so the chromatic endpoint's hue wins outright.
 */
export function oklchInterpolate(
  from: Rgb,
  to: Rgb,
  t: number,
  baseHue: number,
  hueShift: number,
): Rgb {
  const [L1, C1, h1] = rgbToOklch(from);
  const [L2, C2, h2] = rgbToOklch(to);
  const L = L1 + t * (L2 - L1);
  const C = C1 + t * (C2 - C1);
  const naturalH = C1 < 0.001 ? h2 : C2 < 0.001 ? h1 : lerpAngle(h1, h2, t);
  const h = lerpAngle(baseHue, naturalH, hueShift / 100);
  return oklchToRgb([L, Math.max(0, C), h]);
}

export function baseHueOf(rgb: Rgb): number {
  return rgbToOklch(rgb)[2];
}

/** Perceptual distance between two opaque colors in OKLAB (0 = identical, ~1 = black↔white). */
export function oklabDeltaE(hexA: string, hexB: string): number {
  const [L1, a1, b1] = linearRgbToOklab(
    hexToRgb(hexA).map(srgbToLinear) as Rgb,
  );
  const [L2, a2, b2] = linearRgbToOklab(
    hexToRgb(hexB).map(srgbToLinear) as Rgb,
  );
  return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}
