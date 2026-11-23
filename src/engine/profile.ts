import { hueOf, oklabToOklch, toneOf, toOklab, type Color } from "./color-math.js";
import type { ProfileChannel } from "./contract.js";

/** One lane of a profile: what it measures, the bounds it is drawn across, and what to call it. */
export type ProfileLane = {
  channel: ProfileChannel;
  label: string;
  min: number;
  max: number;
  unit: string | null;
};

type Measure = ProfileLane & { measure: (color: Color) => number | null };

const CHANNELS: Record<ProfileChannel, Measure> = {
  "oklab.l": { channel: "oklab.l", label: "Lightness", min: 0, max: 1, unit: null, measure: (c) => toOklab(c)[0] },
  "cielab.l": { channel: "cielab.l", label: "Tone (L*)", min: 0, max: 100, unit: null, measure: (c) => toneOf(toOklab(c)) },
  "oklch.c": { channel: "oklch.c", label: "Chroma", min: 0, max: 0.4, unit: null, measure: (c) => oklabToOklch(toOklab(c))[1] },
  "oklch.h": { channel: "oklch.h", label: "Hue", min: 0, max: 360, unit: "°", measure: hueOf },
  alpha: { channel: "alpha", label: "Opacity", min: 0, max: 1, unit: null, measure: (c) => c.alpha },
};

export const DEFAULT_PROFILE: ProfileChannel[] = ["oklab.l", "oklch.c", "oklch.h"];

export function laneOf(channel: ProfileChannel): ProfileLane {
  const { measure: _, ...lane } = CHANNELS[channel];
  return lane;
}

/** The color's value in each lane, in order; null where the lane has nothing to say, such as the hue of a gray. */
export function measureIn(lanes: ProfileLane[], color: Color): (number | null)[] {
  return lanes.map((lane) => CHANNELS[lane.channel].measure(color));
}
