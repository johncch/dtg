export type Rgb = [number, number, number];

const COLOR_FORMS =
  "#rgb, #rrggbb, oklch(L C H), oklab(L a b), color(srgb r g b) or color(display-p3 r g b), each with an optional `/ alpha`";

/**
 * A colour literal from a definition file. Authoring is not limited to sRGB:
 * `oklch()` reaches colours no hex can name, and `color(display-p3 ...)` names
 * a colour in the gamut it was picked in. The parsed colour keeps that space —
 * see Color — so nothing is clipped on the way in.
 */
export function parseColor(value: unknown, context: string): Color {
  if (typeof value !== "string") {
    throw new Error(
      `${context}: expected a color, got ${JSON.stringify(value)} (${COLOR_FORMS})`,
    );
  }
  const text = value.trim();

  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((d) => d + d)
            .join("")
        : hex[1];
    return colorFromHex("#" + digits.toLowerCase());
  }

  const call = /^([a-zA-Z-]+)\(([^()]*)\)$/.exec(text);
  if (!call) {
    throw new Error(
      `${context}: cannot read ${JSON.stringify(value)} as a color (${COLOR_FORMS})`,
    );
  }
  const fn = call[1].toLowerCase();
  const [body, alphaText, ...extra] = call[2].split("/");
  if (extra.length > 0) {
    throw new Error(`${context}: ${JSON.stringify(value)} has more than one \`/\``);
  }
  const alpha =
    alphaText == null ? 1 : component(alphaText, 1, `${context}: alpha`);
  const parts = body.trim().split(/\s+/).filter(Boolean);

  if (fn === "oklch" || fn === "oklab") {
    expectCount(parts, 3, fn, context, value);
    const L = component(parts[0], 1, `${context}: ${fn} L`);
    if (fn === "oklab") {
      return {
        space: "oklab",
        coords: [
          L,
          component(parts[1], 0.4, `${context}: oklab a`),
          component(parts[2], 0.4, `${context}: oklab b`),
        ],
        alpha,
      };
    }
    const C = component(parts[1], 0.4, `${context}: oklch C`);
    const H = angle(parts[2], `${context}: oklch H`);
    return { space: "oklab", coords: oklchToOklab([L, C, H]), alpha };
  }

  if (fn === "color") {
    const space = parts[0]?.toLowerCase();
    if (space !== "srgb" && space !== "display-p3") {
      throw new Error(
        `${context}: color() space must be srgb or display-p3, got ${JSON.stringify(parts[0] ?? "")}`,
      );
    }
    const channels = parts.slice(1);
    expectCount(channels, 3, `color(${space} ...)`, context, value);
    return {
      space,
      coords: channels.map((c, i) =>
        component(c, 1, `${context}: ${space} channel ${i + 1}`),
      ) as [number, number, number],
      alpha,
    };
  }

  throw new Error(
    `${context}: unknown color function "${fn}" in ${JSON.stringify(value)} (${COLOR_FORMS})`,
  );
}

function expectCount(
  parts: string[],
  n: number,
  fn: string,
  context: string,
  value: string,
): void {
  if (parts.length !== n) {
    throw new Error(
      `${context}: ${fn} takes ${n} components, got ${parts.length} in ${JSON.stringify(value)}`,
    );
  }
}

/** A number, or a percentage of `full` — CSS lets either stand in most slots. */
function component(text: string, full: number, context: string): number {
  const raw = text.trim();
  const pct = raw.endsWith("%");
  const n = Number(pct ? raw.slice(0, -1) : raw);
  if (raw === "" || !Number.isFinite(n)) {
    throw new Error(`${context}: expected a number, got ${JSON.stringify(raw)}`);
  }
  return pct ? (n / 100) * full : n;
}

function angle(text: string, context: string): number {
  const raw = text.trim().toLowerCase();
  const n = Number(raw.endsWith("deg") ? raw.slice(0, -3) : raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${context}: expected an angle, got ${JSON.stringify(text)}`);
  }
  return n;
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
        Math.max(0, Math.min(255, roundChannel(c)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** Channels round half-up. No snapping: a colour formatted in its own space
 * never round-trips, so there is no float noise to snap away. */
export function roundChannel(c: number): number {
  return Math.round(c);
}

/**
 * A colour carrying an alpha, for a value that will be composited by
 * something else. One implementation because four had already drifted —
 * three algorithms and the resolver each formatted this, and they disagreed
 * about whether the alpha arrived as a percent or a fraction.
 */
export function translucent(rgb: Rgb, alphaPercent: number): string {
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, roundChannel(c))));
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

/**
 * Only the forward matrices are written down; the reverse pair is derived by
 * inverting them. Published OKLab matrices are rounded independently in each
 * direction, so forward-then-back drifts by about 1e-7 relative — invisible
 * on integer channels, fatal exactly on a half-way boundary, where 229.5
 * comes back as 229.49997 and rounds the wrong way.
 */
const RGB_TO_LMS: M3 = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
const LMS_TO_OKLAB: M3 = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];
const LMS_TO_RGB = invert(RGB_TO_LMS);
const OKLAB_TO_LMS = invert(LMS_TO_OKLAB);

function linearRgbToOklab(rgb: Rgb): [number, number, number] {
  const lms = matmul(RGB_TO_LMS, rgb).map(Math.cbrt) as Rgb;
  return matmul(LMS_TO_OKLAB, lms);
}

function oklabToLinearRgb(lab: [number, number, number]): Rgb {
  const lms = matmul(OKLAB_TO_LMS, lab).map((c) => c ** 3) as Rgb;
  return matmul(LMS_TO_RGB, lms);
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

/**
 * `emittable` is false where a blend produces a value the CSS emitter cannot
 * yet ship safely — a bare `color(display-p3 ...)` with no sRGB fallback is
 * dropped whole by a browser that cannot parse it, taking the custom property
 * with it. The comparison tools still show every space; only emit is gated.
 */
export const BLEND_SPACES: {
  id: BlendSpace;
  label: string;
  note: string;
  emittable: boolean;
}[] = [
  {
    id: "srgb",
    emittable: true,
    label: "sRGB",
    note: "What browsers and design tools actually do. Lerps the stored byte.",
  },
  {
    id: "srgb-linear",
    emittable: true,
    label: "sRGB linear",
    note: "Physically correct — lerps emitted light. What film and games use.",
  },
  {
    id: "oklab",
    emittable: true,
    label: "OKLab",
    note: "Perceptual. Holds hue exactly when mixing toward a neutral.",
  },
  {
    id: "display-p3",
    emittable: false,
    label: "Display P3",
    note: "The same operation as sRGB, in P3 primaries. A wider display.",
  },
];

/** Mix two colours by `t` of A over B, in the named space. */
export function mixIn(a: Color, b: Color, t: number, space: BlendSpace): Color {
  const lerp = (x: number, y: number) => t * x + (1 - t) * y;

  if (space === "oklab") {
    const A = toOklab(a);
    const B = toOklab(b);
    return colorFromOklab(A.map((c, i) => lerp(c, B[i])) as Oklab);
  }

  const gamut: Gamut = space === "display-p3" ? "display-p3" : "srgb";
  const A = channelsIn(a, gamut);
  const B = channelsIn(b, gamut);
  if (space === "srgb-linear") {
    const mixed = A.map((c, i) =>
      lerp(srgbToLinear(c), srgbToLinear(B[i])),
    ) as Rgb;
    return colorFromRgb(mixed.map(linearToSrgb) as Rgb, gamut);
  }
  return colorFromRgb(A.map((c, i) => lerp(c, B[i])) as Rgb, gamut);
}

// ---- Color: tagged with the space it was authored in ---------------------

/**
 * A colour keeps the space it arrived in and converts only when something
 * asks for a different one. Canonicalising everything up front looks tidier
 * but manufactures round trips: an sRGB colour emitted as sRGB would convert
 * out and back for no reason, and a value landing exactly on a half-way
 * boundary — #ff0000 at 10% over white is exactly 229.5 — then rounds
 * whichever way the float noise fell.
 *
 * `coords` are encoded channels 0..1 for the RGB spaces, and L/a/b for oklab.
 */
export type ColorSpace = Gamut | "oklab";

export type Color = {
  space: ColorSpace;
  coords: [number, number, number];
  alpha: number;
};

export function colorFromHex(hex: string, alpha = 1): Color {
  return {
    space: "srgb",
    coords: hexToRgb(hex).map((c) => c / 255) as Rgb,
    alpha,
  };
}

/** From channels 0..255 in a gamut, the form the ramp algorithms work in. */
export function colorFromRgb(
  rgb: Rgb,
  space: Gamut = "srgb",
  alpha = 1,
): Color {
  return { space, coords: rgb.map((c) => c / 255) as Rgb, alpha };
}

export function colorFromOklab(lab: Oklab, alpha = 1): Color {
  return { space: "oklab", coords: lab, alpha };
}

export function isOpaque(color: Color): boolean {
  return color.alpha >= 1;
}

export function toOklab(color: Color): Oklab {
  if (color.space === "oklab") return color.coords;
  return encodedToOklab(color.coords, color.space);
}

/** Converts if the space differs; returns the colour untouched if it does not. */
export function convert(color: Color, space: ColorSpace): Color {
  if (color.space === space) return color;
  const lab = toOklab(color);
  if (space === "oklab") return { space, coords: lab, alpha: color.alpha };
  const [coords] = encodeIn(lab, space);
  return { space, coords, alpha: color.alpha };
}

/** True when the target has to reduce chroma to hold this colour. */
export function needsMapping(color: Color, gamut: Gamut): boolean {
  if (color.space === gamut) return false;
  return !inGamut(toOklab(color), gamut);
}

/**
 * Render a colour for one target. A colour already in the target space is
 * formatted straight from its own coordinates — no conversion, so no drift.
 */
export function formatColor(color: Color, gamut: Gamut): string {
  const { coords, alpha } = convert(color, gamut);
  if (gamut === "srgb") {
    const rgb = coords.map((c) => c * 255) as Rgb;
    return alpha >= 1 ? rgbToHex(rgb) : translucent(rgb, alpha * 100);
  }
  const parts = coords
    .map((c) =>
      Math.max(0, Math.min(1, c))
        .toFixed(4)
        .replace(/0+$/, "")
        .replace(/\.$/, "") || "0",
    )
    .join(" ");
  return `color(display-p3 ${parts}${alpha >= 1 ? "" : ` / ${Number(alpha.toFixed(4))}`})`;
}

/**
 * Encoded channels 0..255 in a gamut — the form the ramp arithmetic works in.
 * A colour already in that gamut comes back at its authored bytes exactly.
 */
export function channelsIn(color: Color, gamut: Gamut): Rgb {
  return convert(color, gamut).coords.map((c) => c * 255) as Rgb;
}

/**
 * The gamut a transform should work in: the widest any input was authored in.
 * Compositing a P3 colour in sRGB would clip it before the arithmetic ran,
 * so one wide input widens the whole operation.
 */
export function widestGamut(colors: Color[]): Gamut {
  return colors.some((c) => c.space === "display-p3") ? "display-p3" : "srgb";
}
