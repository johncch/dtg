import { formatAuthored, HEX_SPACE, inGamut, parseColor, toOklab, type Color, type Gamut, type Oklab } from "./color-math.js";

type Entry = { color: Color; locked: boolean };

const TARGET_DISTANCE = 0.16;
const MAX_MOVEMENT = 0.12;
const MOVEMENT_COST = 0.2;
const DIRECTIONS: Oklab[] = [];

for (const L of [-1, 0, 1]) {
  for (const a of [-1, 0, 1]) {
    for (const b of [-1, 0, 1]) {
      const length = Math.hypot(L, a, b);
      if (length > 0) DIRECTIONS.push([L / length, a / length, b / length]);
    }
  }
}

function distance(a: Oklab, b: Oklab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function spreadPalette(entries: readonly Entry[], gamut: Gamut): Color[] {
  const colors = entries.map((entry) => entry.color);
  if (entries.length < 2 || entries.every((entry) => entry.locked)) return colors;
  const original = colors.map(toOklab);
  const points = [...original];
  const gamuts = original.map((point) => inGamut(point, HEX_SPACE) ? HEX_SPACE : gamut);
  const nearest = (point: Oklab, index: number) => {
    let closest = Infinity;
    for (let other = 0; other < points.length; other++) {
      if (other !== index) closest = Math.min(closest, distance(point, points[other]));
    }
    return closest;
  };

  for (const step of [0.08, 0.04, 0.02, 0.01, 0.005, 0.0025]) {
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (let index = 0; index < entries.length; index++) {
        if (entries[index].locked) continue;
        const current = points[index];
        const separation = nearest(current, index);
        if (separation >= TARGET_DISTANCE) continue;
        let bestScore = separation - MOVEMENT_COST * distance(current, original[index]);
        let bestPoint = current;
        let bestColor = colors[index];

        for (const direction of DIRECTIONS) {
          const candidate = current.map((value, channel) => value + step * direction[channel]) as Oklab;
          if (distance(candidate, original[index]) > MAX_MOVEMENT || !inGamut(candidate, gamuts[index])) continue;
          const color = parseColor(formatAuthored(candidate, colors[index].alpha), "Spread");
          const point = toOklab(color);
          const movement = distance(point, original[index]);
          if (movement > MAX_MOVEMENT || !inGamut(point, gamuts[index])) continue;
          const apart = nearest(point, index);
          if (apart < separation) continue;
          const score = Math.min(TARGET_DISTANCE, apart) - MOVEMENT_COST * movement;
          if (score <= bestScore + 1e-7) continue;
          bestScore = score;
          bestPoint = point;
          bestColor = { ...color, alpha: entries[index].color.alpha };
        }

        if (bestPoint === current) continue;
        points[index] = bestPoint;
        colors[index] = bestColor;
        moved = true;
      }
      if (!moved) break;
    }
  }
  return colors;
}
