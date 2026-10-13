import {
  encodedToOklab,
  encodeIn,
  inGamut,
  oklabToOklch,
  oklchToOklab,
  type Gamut,
  type Oklch,
  type Rgb,
} from "../../src/color-math.js";

export type Box = { name: string; min: number; max: number; step: number; digits: number };

/**
 * A way of reading a color as numbers. RGB, HSL and HSB mean sRGB here, as
 * they do in CSS and as hex does: the same three numbers measured in P3 would
 * be a different color, so P3 is its own entry rather than a hidden mode.
 */
export type Notation = {
  label: string;
  boxes: Box[];
  read(color: Oklch): number[];
  write(numbers: number[]): Oklch;
  /** The gamut the numbers live in; a color outside it reads as its nearest one inside. */
  gamut: Gamut | null;
};

const channel = (name: string): Box => ({ name, min: 0, max: 255, step: 1, digits: 0 });
const percent = (name: string): Box => ({ name, min: 0, max: 100, step: 1, digits: 0 });
const hue: Box = { name: "Hue", min: 0, max: 360, step: 1, digits: 0 };
const unit = (name: string): Box => ({ name, min: 0, max: 1, step: 0.001, digits: 3 });

const encoded = (color: Oklch, gamut: Gamut): Rgb => encodeIn(oklchToOklab(color), gamut)[0];
const decoded = (rgb: Rgb, gamut: Gamut): Oklch => oklabToOklch(encodedToOklab(rgb, gamut));

// Below this, a spread between channels is rounding error from the conversion, not color.
const GRAY = 1e-9;

function hueOf([r, g, b]: Rgb, max: number, spread: number): number {
  if (spread < GRAY) return 0;
  const sixth = max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
  return (sixth * 60 + 360) % 360;
}

function rgbToHsl(rgb: Rgb): number[] {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const lightness = (max + min) / 2;
  const spread = max - min;
  const saturation = spread < GRAY ? 0 : spread / (1 - Math.abs(2 * lightness - 1));
  return [hueOf(rgb, max, spread), saturation * 100, lightness * 100];
}

function hslToRgb([h, s, l]: number[]): Rgb {
  const amount = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const at = (n: number) => {
    const k = (n + h / 30) % 12;
    return l / 100 - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [at(0), at(8), at(4)];
}

function rgbToHsb(rgb: Rgb): number[] {
  const max = Math.max(...rgb);
  const spread = max - Math.min(...rgb);
  return [hueOf(rgb, max, spread), spread < GRAY ? 0 : (spread / max) * 100, max * 100];
}

function hsbToRgb([h, s, b]: number[]): Rgb {
  const at = (n: number) => {
    const k = (n + h / 60) % 6;
    return b / 100 - (b / 100) * (s / 100) * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [at(5), at(3), at(1)];
}

export const NOTATIONS = {
  oklch: {
    label: "OKLCH",
    boxes: [
      { name: "Lightness", min: 0, max: 1, step: 0.001, digits: 3 },
      { name: "Chroma", min: 0, max: 0.5, step: 0.001, digits: 3 },
      { name: "Hue", min: 0, max: 360, step: 0.1, digits: 1 },
    ],
    read: (color) => color,
    write: (numbers) => numbers as Oklch,
    gamut: null,
  },
  rgb: {
    label: "RGB",
    boxes: [channel("Red"), channel("Green"), channel("Blue")],
    read: (color) => encoded(color, "srgb").map((c) => c * 255),
    write: (numbers) => decoded(numbers.map((n) => n / 255) as Rgb, "srgb"),
    gamut: "srgb",
  },
  hsl: {
    label: "HSL",
    boxes: [hue, percent("Saturation"), percent("Lightness")],
    read: (color) => rgbToHsl(encoded(color, "srgb")),
    write: (numbers) => decoded(hslToRgb(numbers), "srgb"),
    gamut: "srgb",
  },
  hsb: {
    label: "HSB",
    boxes: [hue, percent("Saturation"), percent("Brightness")],
    read: (color) => rgbToHsb(encoded(color, "srgb")),
    write: (numbers) => decoded(hsbToRgb(numbers), "srgb"),
    gamut: "srgb",
  },
  p3: {
    label: "Display P3",
    boxes: [unit("Red"), unit("Green"), unit("Blue")],
    read: (color) => encoded(color, "display-p3"),
    write: (numbers) => decoded(numbers as Rgb, "display-p3"),
    gamut: "display-p3",
  },
} satisfies Record<string, Notation>;

export type NotationId = keyof typeof NOTATIONS;

/** False when the notation's numbers are the nearest color it can express, not the color itself. */
export function isExactIn(color: Oklch, gamut: Gamut | null): boolean {
  return gamut == null || inGamut(oklchToOklab(color), gamut);
}
