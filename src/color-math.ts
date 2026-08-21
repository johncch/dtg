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

/**
 * A colour carrying an alpha, for a value that will be composited by
 * something else. One implementation because four had already drifted —
 * three algorithms and the resolver each formatted this, and they disagreed
 * about whether the alpha arrived as a percent or a fraction.
 */
export function translucent(rgb: Rgb, alphaPercent: number): string {
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))));
  return `rgba(${r}, ${g}, ${b}, ${alphaPercent / 100})`;
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

// ---- gamuts -------------------------------------------------------------
// A gamut is which colours exist; OKLab is unbounded and holds any of them.
// Everything below is about landing an OKLab colour in a real display space.

export type Gamut = "srgb" | "display-p3";

export type Oklab = [number, number, number];
export type Oklch = [number, number, number];

/**
 * Both matrices are derived from primaries and a shared white point rather
 * than pasted from a table: rounded published matrices do not share an exact
 * white point, so white lands at 1.00013 in the other space and every
 * in-gamut check near white becomes a coin toss.
 */
const PRIMARIES: Record<Gamut, { r: XY; g: XY; b: XY }> = {
  srgb: { r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06] },
  "display-p3": { r: [0.68, 0.32], g: [0.265, 0.69], b: [0.15, 0.06] },
};
const D65: XY = [0.3127, 0.329];

type XY = [number, number];
type M3 = number[][];

function xyzOf([x, y]: XY): [number, number, number] {
  return [x / y, 1, (1 - x - y) / y];
}

function invert(m: M3): M3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

function toXyzMatrix(gamut: Gamut): M3 {
  const { r, g, b } = PRIMARIES[gamut];
  const cols = [xyzOf(r), xyzOf(g), xyzOf(b)];
  const m: M3 = [0, 1, 2].map((row) => cols.map((c) => c[row]));
  const scale = matmul(invert(m), xyzOf(D65));
  return m.map((row) => row.map((v, i) => v * scale[i]));
}

const TO_XYZ: Record<Gamut, M3> = {
  srgb: toXyzMatrix("srgb"),
  "display-p3": toXyzMatrix("display-p3"),
};

const FROM_XYZ: Record<Gamut, M3> = {
  srgb: invert(TO_XYZ.srgb),
  "display-p3": invert(TO_XYZ["display-p3"]),
};

function matmul(m: number[][], v: number[]): [number, number, number] {
  return m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) as Rgb;
}

/** Display-P3 uses the sRGB transfer function; only the primaries differ. */
export function oklabToLinear(lab: Oklab, gamut: Gamut): Rgb {
  const srgbLinear = oklabToLinearRgb(lab);
  if (gamut === "srgb") return srgbLinear;
  return matmul(FROM_XYZ[gamut], matmul(TO_XYZ.srgb, srgbLinear));
}

export function linearToOklab(linear: Rgb, gamut: Gamut): Oklab {
  if (gamut === "srgb") return linearRgbToOklab(linear);
  return linearRgbToOklab(matmul(FROM_XYZ.srgb, matmul(TO_XYZ[gamut], linear)));
}

export function oklabToOklch([L, a, b]: Oklab): Oklch {
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

export function oklchToOklab([L, C, h]: Oklch): Oklab {
  const r = (h * Math.PI) / 180;
  return [L, C * Math.cos(r), C * Math.sin(r)];
}

/** Does this colour exist in that display space at all? */
export function inGamut(lab: Oklab, gamut: Gamut, epsilon = 1e-6): boolean {
  return oklabToLinear(lab, gamut).every(
    (c) => c >= -epsilon && c <= 1 + epsilon,
  );
}

/**
 * CSS Color 4 gamut mapping: hold lightness and hue, reduce chroma until the
 * colour fits. Naive per-channel clipping shifts hue instead, which is why
 * an over-saturated red clips toward orange.
 */
export function gamutMap(lab: Oklab, gamut: Gamut): Oklab {
  if (inGamut(lab, gamut)) return lab;
  const [L, C, h] = oklabToOklch(lab);
  if (L >= 1) return [1, 0, 0];
  if (L <= 0) return [0, 0, 0];
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToOklab([L, mid, h]), gamut)) lo = mid;
    else hi = mid;
  }
  return oklchToOklab([L, lo, h]);
}

/** The most chroma this gamut can hold at a given lightness and hue. */
export function maxChroma(L: number, h: number, gamut: Gamut): number {
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToOklab([L, mid, h]), gamut)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Encoded channels 0..1 in the target gamut, gamut-mapped if it must be. */
export function encodeIn(lab: Oklab, gamut: Gamut): [Rgb, boolean] {
  const clipped = !inGamut(lab, gamut);
  const linear = oklabToLinear(clipped ? gamutMap(lab, gamut) : lab, gamut);
  return [
    linear.map((c) => Math.min(1, Math.max(0, linearToSrgb(c) / 255))) as Rgb,
    clipped,
  ];
}

export function formatIn(lab: Oklab, gamut: Gamut): string {
  const [channels] = encodeIn(lab, gamut);
  if (gamut === "srgb") return rgbToHex(channels.map((c) => c * 255) as Rgb);
  const parts = channels
    .map((c) => c.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") || "0")
    .join(" ");
  return `color(display-p3 ${parts})`;
}

/** Encoded channels 0..1 in a gamut → OKLab. The inverse of encodeIn. */
export function encodedToOklab(channels: Rgb, gamut: Gamut): Oklab {
  return linearToOklab(
    channels.map((c) => srgbToLinear(c * 255)) as Rgb,
    gamut,
  );
}

export function hexToOklab(hex: string): Oklab {
  return linearRgbToOklab(hexToRgb(hex).map(srgbToLinear) as Rgb);
}

/** The spaces a blend can happen in, and what each one is good for. */
/** CSS color-mix() interpolation spaces — `color-mix(in <space>, a p%, b)`. */
export type BlendSpace = "srgb" | "srgb-linear" | "oklab" | "display-p3";

export const BLEND_SPACES: { id: BlendSpace; label: string; note: string }[] = [
  {
    id: "srgb",
    label: "sRGB",
    note: "What browsers and design tools actually do. Lerps the stored byte.",
  },
  {
    id: "srgb-linear",
    label: "sRGB linear",
    note: "Physically correct — lerps emitted light. What film and games use.",
  },
  {
    id: "oklab",
    label: "OKLab",
    note: "Perceptual. Holds hue exactly when mixing toward a neutral.",
  },
  {
    id: "display-p3",
    label: "Display P3",
    note: "The same operation as sRGB, in P3 primaries. A wider display.",
  },
];

/** Mix two colours by `t` of A over B, in the named space. */
export function mixIn(
  hexA: string,
  hexB: string,
  t: number,
  space: BlendSpace,
): { css: string; hex: string } {
  const A = hexToRgb(hexA);
  const B = hexToRgb(hexB);
  const lerp = (x: number, y: number) => t * x + (1 - t) * y;

  if (space === "srgb") {
    const hex = rgbToHex(A.map((c, i) => lerp(c, B[i])) as Rgb);
    return { css: hex, hex };
  }
  if (space === "srgb-linear") {
    const mixed = A.map((c, i) =>
      lerp(srgbToLinear(c), srgbToLinear(B[i])),
    ) as Rgb;
    const hex = rgbToHex(mixed.map(linearToSrgb) as Rgb);
    return { css: hex, hex };
  }
  if (space === "oklab") {
    const a = hexToOklab(hexA);
    const b = hexToOklab(hexB);
    const lab = a.map((c, i) => lerp(c, b[i])) as Oklab;
    return { css: formatIn(lab, "srgb"), hex: formatIn(lab, "srgb") };
  }
  const [pa] = encodeIn(hexToOklab(hexA), "display-p3");
  const [pb] = encodeIn(hexToOklab(hexB), "display-p3");
  const mixed = pa.map((c, i) => lerp(c, pb[i])) as Rgb;
  const parts = mixed
    .map((c) => c.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") || "0")
    .join(" ");
  // The sRGB column is what that P3 colour falls back to, for comparison.
  const lab = linearToOklab(
    mixed.map((c) => srgbToLinear(c * 255)) as Rgb,
    "display-p3",
  );
  return { css: `color(display-p3 ${parts})`, hex: formatIn(lab, "srgb") };
}
