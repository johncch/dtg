import { useMemo } from "react";
import { hueOf, maxChroma, oklabToOklch, toOklab, type Color, type Gamut } from "../src/engine/color-math.js";
import { profileOf, type Profile as Measured } from "../src/engine/resolve.js";
import type { ProfileLane } from "../src/engine/profile.js";
import type { SnapshotSystem } from "../src/engine/snapshot.js";
import { paintCss } from "./paint.js";

const WIDTH = 460;
const LEFT = 40;
const RIGHT = 8;
const TOP = 0;
const LANE = 54;
const GAP = 10;
const LABEL = 17;
const STRIP = 16;

/** The system's ramp measured from what it makes: one lane per channel over the selector, the colors under them, the emitted steps as dots. */
export function Profile({ system, constants, gamut }: { system: SnapshotSystem; constants: ReadonlyMap<string, Color>; gamut: Gamut }) {
  const profile = useMemo(() => withoutEmptyLanes(profileOf(system, constants)), [system, constants]);
  const ceilings = useMemo(() => (profile ? ceilingsOf(profile, gamut) : []), [profile, gamut]);
  const hues = profile ? huesOf(profile) : "";
  const chromaRoom = useMemo(() => roomAlong(hues, gamut), [hues, gamut]);
  if (!profile) return null;

  const { span, lanes, samples, marks } = profile;
  const bounds = lanes.map((lane, index) => boundsOf(lane, profile, index, chromaRoom));
  const laneTop = (index: number) => TOP + LABEL + index * (LABEL + LANE + GAP);
  const stripTop = laneTop(lanes.length) - LABEL - GAP + 6;
  const axisY = stripTop + STRIP + 14;
  const height = axisY + 6;
  const x = (at: number) => LEFT + ((at - span.min) / (span.max - span.min)) * (WIDTH - LEFT - RIGHT);
  const y = (index: number, value: number) => {
    const { min, max } = bounds[index];
    return laneTop(index) + LANE - ((value - min) / (max - min)) * LANE;
  };
  const path = (index: number, values: (number | null)[] = samples.map((sample) => sample.values[index])) => {
    let d = "";
    let pen = false;
    samples.forEach((sample, i) => {
      const value = values[i];
      if (value == null || value > bounds[index].max) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(sample.at).toFixed(1)},${y(index, value).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const cell = (WIDTH - LEFT - RIGHT) / (samples.length - 1);

  return (
    <section className="box">
      <h2 className="box-title">Profile</h2>
      <div className="profile-body">
        {lanes.map((lane, index) => (
          <span
            key={lane.channel}
            className="profile-lane-name"
            style={{ left: `${(LEFT / WIDTH) * 100}%`, top: `${((laneTop(index) - 3) / height) * 100}%` }}
          >
            {lane.label}
            {lane.channel === "oklch.c" &&
              ceilings.map((ceiling) => (
                <span key={ceiling.gamut} className="profile-legend">
                  <svg width="14" height="6" aria-hidden>
                    <line x1="0" x2="14" y1="3" y2="3" className={`profile-ceiling profile-ceiling-${ceiling.gamut}`} />
                  </svg>
                  {ceiling.gamut === "srgb" ? "sRGB" : "P3"} limit
                </span>
              ))}
          </span>
        ))}
        <svg
          className="profile-chart"
          viewBox={`0 0 ${WIDTH} ${height}`}
          role="img"
          aria-label={`${lanes.map((lane) => lane.label).join(", ")} across ${profile.along}`}
        >
          {lanes.map((lane, index) => (
            <g key={lane.channel}>
              {ticksOf(bounds[index]).map((tick) => (
                <g key={tick}>
                  <line className={tick === 0 ? "profile-grid profile-zero" : "profile-grid"} x1={LEFT} x2={WIDTH - RIGHT} y1={y(index, tick)} y2={y(index, tick)} />
                  <text className="curve-axis-label" x={LEFT - 6} y={y(index, tick) + 3} textAnchor="end">
                    {formatValue(tick, lane)}
                  </text>
                </g>
              ))}
              {lane.channel === "oklch.c" &&
                ceilings.map((ceiling) => (
                  <path key={ceiling.gamut} className={`profile-ceiling profile-ceiling-${ceiling.gamut}`} d={path(index, ceiling.values)} />
                ))}
              <path className="curve-line" d={path(index)} />
              {marks.map((mark) => {
                const value = mark.values[index];
                if (value == null) return null;
                return (
                  <circle key={mark.step} className="curve-mark" cx={x(mark.at)} cy={y(index, value)} r={4} style={{ fill: paintCss(mark.color) }}>
                    <title>{mark.step}</title>
                  </circle>
                );
              })}
            </g>
          ))}
          {samples.map((sample, index) => (
            <rect
              key={index}
              x={x(sample.at) - (index === 0 ? 0 : cell / 2)}
              y={stripTop}
              width={index === 0 || index === samples.length - 1 ? cell / 2 + 0.5 : cell + 0.5}
              height={STRIP}
              style={{ fill: paintCss(sample.color) }}
            />
          ))}
          {[span.min, (span.min + span.max) / 2, span.max].map((at, index) => (
            <text key={at} className="curve-axis-label" x={x(at)} y={axisY} textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"}>
              {round(at)}
            </text>
          ))}
        </svg>
      </div>
    </section>
  );
}

/**
 * The most chroma a gamut holds at each sample's lightness and hue: the edge a
 * ramp's chroma cannot pass there. sRGB always, and Display P3 too when the
 * project reaches it.
 */
function ceilingsOf(profile: Measured, gamut: Gamut): { gamut: Gamut; values: (number | null)[] }[] {
  const gamuts: Gamut[] = gamut === "srgb" ? ["srgb"] : ["srgb", gamut];
  return gamuts.map((edge) => ({
    gamut: edge,
    values: profile.samples.map(({ color }) => {
      const hue = hueOf(color);
      return hue == null ? null : maxChroma(oklabToOklch(toOklab(color))[0], hue, edge);
    }),
  }));
}

/** A lane with no value anywhere, such as the hue of a gray ramp, has nothing to draw. */
function withoutEmptyLanes(profile: Measured | null): Measured | null {
  if (!profile) return null;
  const kept = profile.lanes.flatMap((_, index) => (profile.samples.some((sample) => sample.values[index] != null) ? [index] : []));
  const pick = (values: (number | null)[]) => kept.map((index) => values[index]);
  return {
    ...profile,
    lanes: kept.map((index) => profile.lanes[index]),
    samples: profile.samples.map((sample) => ({ ...sample, values: pick(sample.values) })),
    marks: profile.marks.map((mark) => ({ ...mark, values: pick(mark.values) })),
  };
}

/** Chroma draws up to what the ramp reaches, so a muted ramp is not a flat line along the floor; every other lane draws its whole range. */
function boundsOf(lane: ProfileLane, profile: Measured, index: number, room: number): { min: number; max: number } {
  if (lane.channel !== "oklch.c") return { min: lane.min, max: lane.max };
  const reached = Math.max(room, ...[...profile.samples, ...profile.marks].map((point) => point.values[index] ?? 0));
  return { min: 0, max: Math.min(lane.max, Math.max(0.05, Math.ceil(reached * 1.05 * 20) / 20)) };
}

/** The ramp's hues, to the degree, as a key that changes only when they do. */
function huesOf(profile: Measured): string {
  const hues = new Set(profile.samples.flatMap(({ color }) => {
    const hue = hueOf(color);
    return hue == null ? [] : [Math.round(hue) % 360];
  }));
  return [...hues].sort((a, b) => a - b).join(",");
}

/**
 * The most chroma the gamut holds at any lightness for the ramp's hues: the
 * chroma axis's top, so the frame follows the hue and the gamut and stays put
 * while the ramp's own shape changes.
 */
function roomAlong(hues: string, gamut: Gamut): number {
  if (hues === "") return 0;
  let most = 0;
  for (const hue of hues.split(",").map(Number)) {
    for (let lightness = 0.02; lightness < 1; lightness += 0.02) most = Math.max(most, maxChroma(lightness, hue, gamut));
  }
  return most;
}

function ticksOf({ min, max }: { min: number; max: number }): number[] {
  return [min, (min + max) / 2, max];
}

const round = (n: number) => Number(n.toFixed(Math.abs(n) >= 10 ? 1 : 3));

function formatValue(value: number, lane: ProfileLane): string {
  const shown = lane.max > 10 ? String(Math.round(value)) : value.toFixed(lane.channel === "oklch.c" ? 3 : 2);
  return lane.unit ? `${shown}${lane.unit}` : shown;
}
