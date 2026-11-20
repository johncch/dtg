import { HEX_SPACE, maxChroma, oklabToOklch, oklchToOklab, type Oklab, type Oklch } from "./color-math.js";

/** What a roll may produce: any color, or any hue at the base's lightness and chroma. */
export type RollStyle = "anything" | "tone";

/** Where hues sit against the base's. */
export type Harmony = "analogous" | "complementary" | "triad" | "even";

export type RollColor = { path: string; lab: Oklab; locked: boolean };

const HUE_OFFSETS: Record<Exclude<Harmony, "even">, number[]> = {
  analogous: [0, 30, -30, 60, -60],
  complementary: [0, 180],
  triad: [0, 120, 240],
};
const HUELESS_BELOW_CHROMA = 0.02;
const wrap = (hue: number) => ((hue % 360) + 360) % 360;

/** Chroma comes down until hex holds the color, so the color is written as hex. */
function held([L, C, H]: Oklch): Oklab {
  return oklchToOklab([L, Math.min(C, maxChroma(L, H, HEX_SPACE)), H]);
}

/** Any hue, at a lightness and chroma that read as a color rather than a gray or a near-black. */
export function randomColor(random: () => number = Math.random): Oklab {
  return held([0.5 + random() * 0.35, 0.06 + random() * 0.14, random() * 360]);
}

/**
 * Hues for `count` new colors, as far from the fixed hues and from each other
 * as they can be: each gap between fixed hues takes its share of the new
 * ones, spaced evenly inside it. With nothing fixed they start from `start`.
 */
function evenHues(fixed: number[], count: number, start: number): number[] {
  if (fixed.length === 0) return Array.from({ length: count }, (_, index) => wrap(start + (360 * index) / count));
  const sorted = [...new Set(fixed)].sort((a, b) => a - b);
  const gaps = sorted.map((from, index) => ({ from, size: wrap(sorted[(index + 1) % sorted.length] - from) || 360, holds: 0 }));
  for (let placed = 0; placed < count; placed++) {
    gaps.reduce((widest, gap) => (gap.size / (gap.holds + 1) > widest.size / (widest.holds + 1) ? gap : widest)).holds++;
  }
  return gaps.flatMap((gap) => Array.from({ length: gap.holds }, (_, index) => wrap(gap.from + (gap.size * (index + 1)) / (gap.holds + 1))));
}

/** One more color for the palette, in the style a roll would use. The base is the color named, or the first locked one, or the first of all. */
export function addToPalette(
  colors: RollColor[],
  style: RollStyle,
  basePath: string | null,
  random: () => number = Math.random,
): Oklab {
  const base = colors.find((color) => color.path === basePath) ?? colors.find((color) => color.locked) ?? colors[0];
  if (style === "anything" || !base) return randomColor(random);
  const [L, C] = oklabToOklch(base.lab);
  return held([L, C, random() * 360]);
}

/**
 * New colors for the ones a roll may change, by path. Locked colors never
 * change. In `tone` the base does not change either: it is the color named,
 * or the first locked one, or a random one nothing is held to.
 */
export function rollPalette(
  colors: RollColor[],
  style: RollStyle,
  basePath: string | null,
  random: () => number = Math.random,
): Map<string, Oklab> {
  const rolled = new Map<string, Oklab>();
  if (style === "anything") {
    for (const color of colors) if (!color.locked) rolled.set(color.path, randomColor(random));
    return rolled;
  }
  const base = colors.find((color) => color.path === basePath) ?? colors.find((color) => color.locked);
  const [L, C] = oklabToOklch(base?.lab ?? randomColor(random));
  for (const color of colors) {
    if (!color.locked && color !== base) rolled.set(color.path, held([L, C, random() * 360]));
  }
  return rolled;
}

/** The colors a harmony may move, and the hue each goes to. */
function harmonyPlan(colors: RollColor[], harmony: Harmony, basePath: string | null) {
  const base = colors.find((color) => color.path === basePath) ?? colors.find((color) => color.locked) ?? colors[0];
  if (!base) return null;
  const [, baseC, baseH] = oklabToOklch(base.lab);
  const baseHue = baseC < HUELESS_BELOW_CHROMA ? 0 : baseH;
  const free = colors.filter((color) => !color.locked && color !== base);
  const fixed = colors
    .filter((color) => color.locked || color === base)
    .map((color) => oklabToOklch(color.lab))
    .filter(([, C]) => C >= HUELESS_BELOW_CHROMA)
    .map(([, , H]) => H);
  const offsets = harmony === "even" ? null : HUE_OFFSETS[harmony];
  const hues = offsets
    // The base already holds the first place, so the others start at the second.
    ? free.map((_, index) => wrap(baseHue + offsets[(1 + index) % offsets.length]))
    : evenHues(fixed, free.length, baseHue);
  return { free, hues, baseHue, fixed };
}

/** The hues a harmony puts colors at, the base's first and each once: where its arms point on a hue wheel. */
export function harmonyHues(colors: RollColor[], harmony: Harmony, basePath: string | null): number[] {
  const plan = harmonyPlan(colors, harmony, basePath);
  if (!plan) return [];
  const hues: number[] = [];
  for (const hue of [plan.baseHue, ...(harmony === "even" ? plan.fixed : []), ...plan.hues]) {
    if (!hues.some((other) => Math.abs(((hue - other + 540) % 360) - 180) < 0.5)) hues.push(hue);
  }
  return hues;
}

/**
 * The unlocked colors with their hues moved onto a harmony around the base,
 * by path; each keeps its own lightness and chroma. The base is the color
 * named, or the first locked one, or the first of all, and does not move.
 * Nothing here is random: the same palette gives the same answer.
 */
export function harmonizePalette(colors: RollColor[], harmony: Harmony, basePath: string | null): Map<string, Oklab> {
  const moved = new Map<string, Oklab>();
  const plan = harmonyPlan(colors, harmony, basePath);
  if (!plan) return moved;
  const { free, hues } = plan;
  free.forEach((color, index) => {
    const [L, C, H] = oklabToOklch(color.lab);
    // A color written as hex lands a fraction of a degree off its place; moving it again would only shuffle its last digit.
    if (C >= HUELESS_BELOW_CHROMA && Math.abs(((H - hues[index] + 540) % 360) - 180) < 0.5) return;
    moved.set(color.path, held([L, C, hues[index]]));
  });
  return moved;
}
