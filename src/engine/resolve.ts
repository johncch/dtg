import { parse } from "yaml";
import {
  assertNameFragment,
  type Algorithm,
  type Params,
  type SelectorShape,
} from "./contract.js";
import { parseParams, type ParsedColorParam } from "./params.js";
import type { CurveValue, Pivot, Span } from "./curve-math.js";
import {
  formatRef,
  orderOf,
  parseCall,
  canonicalSelector,
  parseSelector,
  publicStepOf,
  rolePath,
  ROOT,
} from "./selector.js";
import {
  needsMapping,
  parseColor,
  spacedSpelling,
  isOpaque,
  formatAuthored,
  toOklab,
  type Color,
  type Gamut,
} from "./color-math.js";
import { accepts, acceptedBy, isRefFunction, REF_FUNCTIONS, splitArguments, wordsOutsideParens, type Accepted, type RefFunction } from "./ref-functions.js";
import { tint } from "./algorithms/tint.js";
import { scale } from "./algorithms/scale.js";
import { overlay } from "./algorithms/overlay.js";
import { curve } from "./algorithms/curve.js";
import { tone } from "./algorithms/tone.js";
import { DEFAULT_PROFILE, laneOf, measureIn, type ProfileLane } from "./profile.js";

const CURVE_SAMPLES = 41;
const CURVE_SWATCHES = 121;
const PROFILE_SAMPLES = 201;

type Mark = { at: number; color: Color; step: string };

/** Each step whose selector is a plain point along `along`: no form, nothing but that field. */
function marksAlong(
  algorithm: Algorithm,
  shape: SelectorShape,
  steps: { selector: string; color: Color; publicStep: string }[],
  along: string,
): Mark[] {
  return steps.flatMap((step) => {
    const { values } = parseSelector(algorithm.name, shape, step.selector);
    const at = values[along];
    return values.form == null && typeof at === "number" ? [{ at, color: step.color, step: step.publicStep }] : [];
  });
}

/** What the algorithm makes at `count` evenly spaced points across `span`, asked along the selector's one field. */
function samplesAlong(algorithm: Algorithm, params: Params, along: string, span: Span, count: number): { at: number; color: Color }[] {
  return Array.from({ length: count }, (_, i) => {
    const at = span.min + (i / (count - 1)) * (span.max - span.min);
    return { at, color: algorithm.resolve({ form: null, [along]: at }, params) };
  });
}

function curvesOf(
  algorithm: Algorithm,
  params: Params,
  shape: SelectorShape,
  steps: ResolvedStep[],
): Record<string, ResolvedCurve> {
  const pivots = algorithm.curvePivots?.(params) ?? {};
  return Object.fromEntries(
    Object.entries(algorithm.params).flatMap(([name, kind]) => {
      if (kind.kind !== "curve" || !pivots[name]) return [];
      const span = spanOf(algorithm, shape, name, kind.along);
      const marks = marksAlong(algorithm, shape, steps, kind.along);
      const curve: ResolvedCurve = {
        value: params[name] as CurveValue,
        pivot: pivots[name],
        min: kind.min,
        max: kind.max,
        default: kind.default,
        along: kind.along,
        span,
        marks,
        label: kind.label ?? null,
        unit: kind.unit ?? null,
      };
      return [[name, curve]];
    }),
  );
}

function spanOf(algorithm: Algorithm, shape: SelectorShape, name: string, along: string): Span {
  const field = shape.fields.find((candidate) => candidate.name === along);
  if (!field || field.kind !== "number") {
    throw new Error(`${algorithm.name} param "${name}" runs along "${along}", which is not a number field of its selector`);
  }
  return { min: field.min, max: field.max };
}

export type CurveDrawing = {
  /** The system's color at evenly spaced points across the span; empty when the selector has fields besides `along`. */
  samples: { at: number; color: Color }[];
  /** What values across the curve's `min`–`max` look like, from the algorithm's `curveSwatch`; empty without one. */
  swatches: { value: number; color: Color }[];
};

/**
 * What the editor draws for one curve param, worked out only when a page
 * shows it: it runs the algorithm a couple of hundred times, far more than
 * resolving the system does. `params` are as a system has them written,
 * defaults filled in; `constants` are the palette colors they may name.
 */
export function curveDrawing(
  system: { algorithm: string; params: Record<string, unknown>; selector: SelectorShape },
  constants: ReadonlyMap<string, Color>,
  name: string,
): CurveDrawing {
  const algorithm = algorithmFor(system.algorithm);
  const kind = algorithm?.params[name];
  if (!algorithm || kind?.kind !== "curve") return { samples: [], swatches: [] };
  const params = parseParams(algorithm, system.params, constants).values;
  const shape = system.selector;
  const span = spanOf(algorithm, shape, name, kind.along);
  const samples = shape.fields.length === 1 ? samplesAlong(algorithm, params, kind.along, span, CURVE_SAMPLES) : [];
  const swatches = algorithm.curveSwatch
    ? Array.from({ length: CURVE_SWATCHES }, (_, i) => {
        const value = kind.min + (i / (CURVE_SWATCHES - 1)) * (kind.max - kind.min);
        return { value, color: algorithm.curveSwatch!(params, name, value) };
      })
    : [];
  return { samples, swatches };
}

export type Profile = {
  along: string;
  span: Span;
  /** The algorithm's channels, then opacity when the colors differ in it. */
  lanes: ProfileLane[];
  /** What the algorithm makes across the span, measured in each lane; overrides are not in them. */
  samples: { at: number; color: Color; values: (number | null)[] }[];
  /** The steps the system emits, as resolved, overrides included, measured the same way. */
  marks: (Mark & { values: (number | null)[] })[];
};

/**
 * A system's ramp measured from what it produces: the algorithm resolved
 * densely along its selector and each color read in the algorithm's profile
 * channels. Null when the selector is not one number field, as there is no
 * single line to draw. Worked out only when a page shows it.
 */
export function profileOf(
  system: {
    algorithm: string;
    params: Record<string, unknown>;
    selector: SelectorShape;
    steps: { selector: string; color: Color; publicStep: string }[];
  },
  constants: ReadonlyMap<string, Color>,
): Profile | null {
  const algorithm = algorithmFor(system.algorithm);
  const [field, ...rest] = system.selector.fields;
  if (!algorithm || !field || rest.length > 0 || field.kind !== "number") return null;
  const params = parseParams(algorithm, system.params, constants).values;
  const span = { min: field.min, max: field.max };
  const sampled = samplesAlong(algorithm, params, field.name, span, PROFILE_SAMPLES);
  const marked = marksAlong(algorithm, system.selector, system.steps, field.name);
  const translucent = [...sampled, ...marked].some(({ color }) => color.alpha !== sampled[0].color.alpha);
  const declared = algorithm.profile ?? DEFAULT_PROFILE;
  const lanes = [...declared, ...(translucent && !declared.includes("alpha") ? (["alpha"] as const) : [])].map(laneOf);
  return {
    along: field.name,
    span,
    lanes,
    samples: sampled.map((sample) => ({ ...sample, values: measureIn(lanes, sample.color) })),
    marks: marked.map((mark) => ({ ...mark, values: measureIn(lanes, mark.color) })),
  };
}

export const builtinAlgorithms: Algorithm[] = [tint, scale, overlay, curve, tone];

function registryOf(extra: Algorithm[]): Map<string, Algorithm> {
  return new Map(
    [...builtinAlgorithms, ...extra].map((algorithm) => [
      algorithm.name,
      algorithm,
    ]),
  );
}

// Top-level keys the tool owns; every other top-level key is a section.
export const TOP_LEVEL_RESERVED = [
  "dtg",
  "modes",
  "defaults",
  "systems",
  "palette",
  "changelog",
];
// A system node's keys. Params live in their own block, so this list can
// grow without ever colliding with an algorithm's parameter names.
const SYSTEM_RESERVED = ["algorithm", "params", "alias", "overrides", "publish", "emit", "description"];

/** A block's `publish`, or `emit`, its earlier spelling, which stays accepted. */
function publishOf(block: Record<string, unknown>, where: string): { value?: unknown; error?: string } {
  if (block.publish !== undefined && block.emit !== undefined) {
    return { error: `${where}: \`emit\` is the earlier spelling of \`publish\` — write one of them` };
  }
  return { value: block.publish ?? block.emit };
}

const RENAMED_ALGORITHMS: Record<string, string> = {
  "ink-ramp": "tint",
  "oklch-scale": "scale",
};

const LITERAL_FUNCTIONS = ["rgb", "rgba", "oklch", "oklab", "color"];

const TRANSPARENT_USAGE = `transparent() takes a color or a gradient, then an opacity, as transparent(shade 70) or transparent(sky(500) 70). For a system's uncomposited form, ask the algorithm — tint spells it "sky(3 tint)".`;

/** A public-name override: one name for all targets, or per-target ("css", "figma"). */
export type AliasValue = string | Record<string, string>;

/** The algorithm registry, for callers that need to re-run one directly. */
export function algorithmFor(
  name: string,
  extra: Algorithm[] = [],
): Algorithm | undefined {
  return registryOf(extra).get(name);
}

export function aliasedName(
  alias: AliasValue | undefined,
  target: string,
  fallback: string,
): string {
  if (alias == null) return fallback;
  if (typeof alias === "string") return alias;
  return alias[target] ?? fallback;
}

/**
 * Total order over a system's steps: the algorithm's key first, then the raw
 * selector, so identical keys still sort deterministically.
 */
function parseChangelog(raw: unknown, errors: string[]): ChangelogEntry[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    errors.push("`changelog` must be a list");
    return [];
  }
  const entries: ChangelogEntry[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item === "string") {
      entries.push({ note: item });
      continue;
    }
    if (item != null && typeof item === "object" && !Array.isArray(item)) {
      const pairs = Object.entries(item as Record<string, unknown>);
      if (pairs.length === 1) {
        const [date, note] = pairs[0];
        entries.push({ date: String(date), note: String(note) });
        continue;
      }
    }
    errors.push(
      `changelog[${i}]: expected "<date>: <note>" or a plain note string`,
    );
  }
  return entries;
}

type OrderedStep = { step: ResolvedStep; order: number[] };

function compareSteps(a: OrderedStep, b: OrderedStep): number {
  for (let i = 0; i < a.order.length; i++) {
    if (a.order[i] !== b.order[i]) return a.order[i] - b.order[i];
  }
  const [x, y] = [a.step.selector, b.step.selector];
  return x < y ? -1 : x > y ? 1 : 0;
}

export type Lineage = Map<
  string,
  { section: string; group: string; role: string; mode: string }[]
>;

export function buildLineage(resolved: ResolvedDefinition): Lineage {
  const lineage: Lineage = new Map();
  for (const role of resolved.roles) {
    role.perMode.forEach((roleEntry, i) => {
      const named: ResolvedRef[] = roleEntry.kind === "gradient" && throughTransparent(roleEntry.target).kind === "constant" ? [roleEntry] : [];
      for (const entry of [...named, ...colorRefsOf(roleEntry)]) {
        if (entry.target.kind === "transparent" && throughTransparent(entry.target).kind === "step") continue;
        const target = throughTransparent(entry.target);
        if (target.kind !== "constant" && target.kind !== "step") continue;
        const key =
          target.kind === "constant"
            ? target.name
            : formatRef(target.system, target.selector);
        const uses = lineage.get(key) ?? [];
        const use = {
          section: role.section,
          group: role.group,
          role: role.role,
          mode: resolved.modes[i] ?? String(i),
        };
        // A gradient can name one color at several stops; that is still one use.
        if (uses.some((other) => JSON.stringify(other) === JSON.stringify(use))) continue;
        uses.push(use);
        lineage.set(key, uses);
      }
    });
  }
  return lineage;
}

export type ResolvedStep = {
  selector: string;
  /** Selector formatted for token names: "5.5" → "5_5". */
  publicStep: string;
  color: Color;
  overridden: boolean;
  /** What the algorithm produced, present only when an override won. */
  generated?: Color;
};

/**
 * A color among a system's params. `from` is where it was written: the
 * system's own `params`, or the `defaults` block every system of that
 * algorithm shares — which is where an edit to it has to land.
 */
export type ResolvedColorParam = ParsedColorParam & { from: "system" | "defaults" };

/**
 * A `curve` param as a page draws it: its value with every field filled in,
 * where it passes through what the algorithm holds fixed, and — because it
 * runs along a selector field — the colors along it and where the system's
 * steps sit on it.
 */
export type ResolvedCurve = {
  value: CurveValue;
  pivot: Pivot;
  min: number;
  max: number;
  default: CurveValue;
  along: string;
  span: Span;
  /** Each emitted step whose selector is a plain point along the curve. */
  marks: { at: number; color: Color; step: string }[];
  /** What the curve's values measure, and the unit written after them; null when the algorithm says nothing. */
  label: string | null;
  unit: string | null;
};

export type ResolvedSystem = {
  /** Internal dotted path — the stable identity refs point at. */
  system: string;
  segments: PathSegment[];
  alias?: AliasValue;
  algorithm: string;
  algorithmDescription: string;
  /** Every param the algorithm declares, as written, or as the algorithm's default where nothing is written. */
  params: Record<string, unknown>;
  /** The top-level params the system wrote itself. */
  ownParams: string[];
  /** The top-level params the `defaults` block writes for this system's algorithm; one the system writes too falls back to it when removed. */
  paramsInDefaults: string[];
  /** The params nothing writes, neither the system nor `defaults`; their value in `params` is the algorithm's default. */
  defaultedParams: string[];
  /** Each `curve` param, every field filled in, with where it passes through what the algorithm holds fixed. */
  curves: Record<string, ResolvedCurve>;
  colorParams: ResolvedColorParam[];
  /** What a ref into this system is made of. */
  selector: SelectorShape;
  steps: ResolvedStep[];
  /** The selectors the system's `publish` lists, which it publishes whether or not a ref asks. */
  emit: string[];
  /** Written by hand in the definition; the algorithm's own is `algorithmDescription`. */
  description?: string;
};

/**
 * Prose notes for whoever replays this definition into a design tool. The
 * resolver never interprets one — the useful part is the intent, which is
 * exactly what a schema would strip out.
 */
export type ChangelogEntry = { date?: string; note: string };

/** One step of a systems-tree path, with the alias that renames it on emit. */
export type PathSegment = {
  name: string;
  alias?: AliasValue;
  /** Dropped from the emitted name: a `virtual` group, or a group's `$root`. The path still uses it for identity. */
  virtual?: boolean;
};

/** A gradient named in the palette. It is kept apart from the colors: everything that works on a palette's colors has no use for it. */
export type ResolvedStaticGradient = {
  path: string;
  segments: PathSegment[];
  written: string;
  gradient: ResolvedGradientRef;
  /** False for one in a group marked `publish: false` that no role points at. */
  emitted: boolean;
};

/** A declared constant. `path` is its internal identity; segments carry aliases. */
export type ResolvedStatic = {
  path: string;
  segments: PathSegment[];
  /** The color as the definition writes it. */
  written: string;
  color: Color;
  /** False for a color in a group marked `publish: false` that no role points at. */
  emitted: boolean;
};

/**
 * Where a palette color or a role named `key` sits under `parent`: its
 * segments, and the path refs and edits name it by. A `$root` is its group's
 * own color, so it takes the group's path and adds a segment no name shows.
 * Any other name starting with `$` is refused.
 */
function placeEntry(
  parent: PathSegment[],
  key: string,
): { segments: PathSegment[]; path: string; root: boolean } | { error: string } {
  const root = key === ROOT;
  if (key.startsWith("$") && !(root && parent.length > 0)) {
    return { error: root ? "`$root` is a group's own color, so it goes in a group" : "a name cannot start with $" };
  }
  const segments: PathSegment[] = [...parent, root ? { name: key, virtual: true } : { name: key }];
  return { segments, path: (root ? parent : segments).map((seg) => seg.name).join("."), root };
}

/** A palette color's, system's or role's public name for a target: each segment's alias applied, virtual segments dropped. */
export function publicPath(
  segments: PathSegment[],
  target: string,
  sep: string,
): string {
  return segments
    .filter((s) => !s.virtual)
    .map((s) => aliasedName(s.alias, target, s.name))
    .join(sep);
}

export type ResolvedSection = {
  name: string;
  alias?: AliasValue;
  description?: string;
};

export type RefTarget =
  | { kind: "step"; system: string; selector: string }
  | { kind: "constant"; name: string }
  | { kind: "role"; group: string; role: string }
  | { kind: "literal" }
  /** `alpha` is the opacity as written, 0–100. */
  | { kind: "transparent"; of: RefTarget; alpha: number }
  /**
   * Written in place as `gradient(…)`; a role pointing at a gradient has that
   * as its target instead. `of` is the gradient a restyle took its stops
   * from, null for one written out color by color.
   */
  | { kind: "gradient"; of: RefTarget | null };

export type PlainRefTarget = Exclude<RefTarget, { kind: "transparent" }>;

export function throughTransparent(target: RefTarget): PlainRefTarget {
  return target.kind === "transparent" ? throughTransparent(target.of) : target;
}

export type ResolvedColorRef = {
  kind: "color";
  ref: string;
  target: RefTarget;
  color: Color;
};

export type GradientStop = {
  color: ResolvedColorRef;
  /** Percent along the line, as written; null where the definition left it to be spread evenly. */
  position: number | null;
};

export const RADIAL_SHAPES = ["circle", "ellipse"] as const;
export const RADIAL_SIZES = ["closest-side", "closest-corner", "farthest-side", "farthest-corner"] as const;
/** The spaces CSS can interpolate a gradient in. */
export const GRADIENT_SPACES = [
  "srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020",
  "lab", "oklab", "xyz", "xyz-d50", "xyz-d65", "hsl", "hwb", "lch", "oklch",
] as const;

/** Angles are degrees as CSS reads them: 0 runs upward, 90 to the right. `x` and `y` are the center, in percent. */
export type GradientGeometry =
  | { kind: "linear"; angle: number }
  | { kind: "radial"; shape: (typeof RADIAL_SHAPES)[number]; size: (typeof RADIAL_SIZES)[number]; x: number; y: number }
  | { kind: "conic"; angle: number; x: number; y: number };

/** The named arguments each kind of gradient takes, beside `kind`, `repeat` and `space`, which all do. */
export const GEOMETRY_ARGUMENTS: Record<GradientGeometry["kind"], string[]> = {
  linear: ["angle"],
  radial: ["x", "y", "shape", "size"],
  conic: ["angle", "x", "y"],
};

/** A gradient is made of colors, and nothing is made of a gradient: only a role holds one or points at one. */
export type ResolvedGradientRef = {
  kind: "gradient";
  ref: string;
  target: RefTarget;
  geometry: GradientGeometry;
  repeat: boolean;
  /** The space its colors are interpolated in; null leaves it to the browser. */
  space: (typeof GRADIENT_SPACES)[number] | null;
  stops: GradientStop[];
};

export type ResolvedRef = ResolvedColorRef | ResolvedGradientRef;

/**
 * The colors an entry names itself: its own, or its stops'. A role pointing
 * at a gradient role, as it is or through transparent(), names none — the
 * role it points at does.
 */
export function colorRefsOf(entry: ResolvedRef): ResolvedColorRef[] {
  if (entry.kind === "color") return [entry];
  return throughTransparent(entry.target).kind === "gradient" ? entry.stops.map((stop) => stop.color) : [];
}

/**
 * True for a role written as a gradient in some modes and a color in others.
 * A role that says the same ref in every mode only follows what it points
 * at, so the mix is that role's to fix and is reported there alone.
 */
export function mixesKinds(perMode: ResolvedRef[]): boolean {
  return new Set(perMode.map((entry) => entry.kind)).size > 1 && new Set(perMode.map((entry) => entry.ref)).size > 1;
}

/**
 * The roles an entry's value comes from. An `inlined` one was read through
 * transparent() or a restyle, so the value holds what that role came to in
 * its mode, where a plain one is written as a pointer at it.
 */
export function rolesUnder(entry: ResolvedRef): { role: Extract<RefTarget, { kind: "role" }>; inlined: boolean }[] {
  const found: ReturnType<typeof rolesUnder> = [];
  const walk = (target: RefTarget, inlined: boolean) => {
    if (target.kind === "role") found.push({ role: target, inlined });
    if (target.kind === "transparent") walk(target.of, true);
    if (target.kind === "gradient" && target.of) walk(target.of, true);
  };
  walk(entry.target, false);
  for (const stop of colorRefsOf(entry)) {
    if (stop !== entry) walk(stop.target, false);
  }
  return found;
}

export type ResolvedRole = {
  section: string;
  /**
   * The full path, one entry per level. Roles nest as deep as the definition
   * nests them, the same as the systems tree — `light.ink.primary` is three
   * segments, `label.primary` is two.
   */
  segments: PathSegment[];
  /** Everything but the last segment, dotted; empty for a role written straight in its section. Derived; `segments` is the truth. */
  group: string;
  /** The last segment, `$root` for a group's own color. Derived. */
  role: string;
  /** Written by hand in the definition, for whoever reads it next. */
  description?: string;
  /** One entry per mode, in `modes` order. */
  perMode: ResolvedRef[];
  /**
   * Index-parallel to `perMode`: true where the role said nothing for the mode
   * and the ref came from the mode it extends. Formats that can leave a mode
   * out check this; formats that cannot ignore it.
   */
  inherited: boolean[];
};

export type ModeScheme = "light" | "dark";

const MODE_SCHEMES: ModeScheme[] = ["light", "dark"];

export type ResolvedMode = {
  name: string;
  /** The mode this one falls back to. Absent on a root, which names every color. */
  extends?: string;
  /** Its own, or the one it extends'. Absent means the definition never said. */
  scheme?: ModeScheme;
};

/** What is wrong, and the dotted path of the role or entry it is wrong in. */
export type Problem = { path: string; message: string };

export function problemText(problem: Problem): string {
  return `${problem.path}: ${problem.message}`;
}

export type ResolvedDefinition = {
  modes: string[];
  /** Index-parallel to `modes`. */
  modeDetails: ResolvedMode[];
  changelog: ChangelogEntry[];
  systems: ResolvedSystem[];
  /** The systems block's own alias (its Figma collection name). */
  systemsAlias?: AliasValue;
  statics: ResolvedStatic[];
  /** The palette's gradients, in the order written. */
  gradients: ResolvedStaticGradient[];
  /** Every palette entry's path, colors and gradients together, in the order written. */
  paletteOrder: string[];
  sections: ResolvedSection[];
  roles: ResolvedRole[];
  /** Hand-written descriptions of groups, by dotted path: system groups, palette groups, and role groups. */
  groupDescriptions: { systems: Record<string, string>; palette: Record<string, string>; roles: Record<string, string> };
  warnings: string[];
  /**
   * What is wrong with a definition that still resolved: every value is
   * there to draw, but the whole is not to be written out. The emitters
   * refuse while any is here, and so does saving from the editor.
   */
  problems: Problem[];
  /** Index-parallel to the `probes` asked for. */
  probed: Probe[];
};

/** A ref into a system resolved without demanding it, so nothing is emitted for it. */
export type Probe = { ref: string; color: Color } | { ref: string; error: string };

export function publicSystemName(
  system: ResolvedSystem,
  target: string,
  sep = "-",
): string {
  return publicPath(system.segments, target, sep);
}

const MODE_KEYS = ["extends", "scheme"];

/**
 * `modes` as a list is every mode a root; as a map, each mode may name the
 * one it extends and its color scheme. Absent returns none.
 */
function parseModes(raw: unknown, errors: string[]): ResolvedMode[] {
  if (raw == null) return [];
  if (typeof raw !== "object" || Object.keys(raw).length === 0) {
    errors.push("`modes`, when present, must be a non-empty list or map");
    return [];
  }
  const entries: [string, unknown][] = Array.isArray(raw)
    ? raw.map((name) => [String(name), null])
    : Object.entries(raw);

  const parsed: ResolvedMode[] = [];
  for (const [name, body] of entries) {
    // A map hands number-like keys back first and sorted, whatever order they
    // were written in, and mode order decides which ref lands in which mode.
    if (/^\d+$/.test(name)) {
      errors.push(`mode "${name}": a mode name cannot be a number`);
      continue;
    }
    if (parsed.some((mode) => mode.name === name)) {
      errors.push(`mode "${name}" is declared more than once`);
      continue;
    }
    if (body != null && (typeof body !== "object" || Array.isArray(body))) {
      errors.push(
        `mode "${name}": expected nothing or { ${MODE_KEYS.join("?, ")}? }`,
      );
      continue;
    }
    const block = (body ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(block)) {
      if (!MODE_KEYS.includes(key)) {
        errors.push(
          `mode "${name}": unknown key "${key}" (known: ${MODE_KEYS.join(", ")})`,
        );
      }
    }

    let parent: ResolvedMode | undefined;
    if (block.extends != null) {
      parent = parsed.find((mode) => mode.name === String(block.extends));
      if (!parent) {
        errors.push(
          `mode "${name}": extends "${block.extends}", which is not a mode declared above it`,
        );
      }
    }
    if (
      block.scheme != null &&
      !MODE_SCHEMES.includes(block.scheme as ModeScheme)
    ) {
      errors.push(
        `mode "${name}": scheme must be one of ${MODE_SCHEMES.join(", ")}, got ${JSON.stringify(block.scheme)}`,
      );
    }
    parsed.push({
      name,
      extends: parent?.name,
      scheme: (block.scheme as ModeScheme | undefined) ?? parent?.scheme,
    });
  }
  return parsed;
}

export function resolveDefinition(
  yamlText: string,
  extraAlgorithms: Algorithm[] = [],
  /** The project's gamut: the widest colors the definition is meant to use. */
  gamut: Gamut = "display-p3",
  /** Refs into systems to resolve on the side, as `sky(7)`. */
  probes: string[] = [],
): ResolvedDefinition {
  // An empty file parses to null; it defines nothing, as `{}` does.
  const doc = (parse(yamlText) ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];
  const problems: Problem[] = [];
  const algorithms = registryOf(extraAlgorithms);

  // A definition that does not say is read as grammar 1, the only one; the editor writes `dtg: 1` when it saves one.
  const grammar = doc.dtg;
  if (grammar != null && Number(grammar) !== 1) {
    errors.push(
      `unsupported grammar version ${JSON.stringify(grammar)} — this tool understands \`dtg: 1\``,
    );
  }
  if (doc.emit !== undefined) {
    errors.push(
      "the `emit:` block was replaced by inline `alias`/`omit` keys on systems, sections, groups, and roles",
    );
  }

  const changelog = parseChangelog(doc.changelog, errors);
  // `modes` is optional. A definition with none is not a degenerate case of a
  // themed one — it is a color dictionary, where every value has a name and
  // nothing varies. The single mode is implicit so the rest of the pipeline
  // (which is written against an axis) needs no special case.
  const declaredModes = parseModes(doc.modes, errors);
  const modeless = declaredModes.length === 0;
  const modeDetails = modeless ? [{ name: "default" }] : declaredModes;
  const modes = modeDetails.map((mode) => mode.name);
  const parentIndex = modeDetails.map((mode) =>
    mode.extends === undefined ? undefined : modes.indexOf(mode.extends),
  );
  const lastRootIndex = parentIndex.lastIndexOf(undefined);

  const defaults = (doc.defaults ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  for (const algoName of Object.keys(defaults)) {
    const renamedTo = RENAMED_ALGORITHMS[algoName];
    if (renamedTo) {
      errors.push(
        `defaults: \`${algoName}\` was renamed to \`${renamedTo}\``,
      );
    } else if (!algorithms.has(algoName)) {
      warnings.push(`defaults declared for unknown algorithm "${algoName}"`);
    }
  }

  function parseAlias(raw: unknown, context: string): AliasValue | undefined {
    if (raw == null) return undefined;
    if (typeof raw === "string") return raw;
    if (typeof raw === "object" && !Array.isArray(raw)) {
      const map: Record<string, string> = {};
      for (const [target, name] of Object.entries(raw)) {
        if (typeof name !== "string") {
          errors.push(
            `${context}: alias for target "${target}" must be a string`,
          );
          return undefined;
        }
        map[target] = name;
      }
      return map;
    }
    errors.push(`${context}: alias must be a string or a target → name map`);
    return undefined;
  }

  type SystemEntry = {
    algo: Algorithm;
    /** As written, `defaults` merged under the system's own. */
    writtenParams: Record<string, unknown>;
    params: Params;
    colorParams: ParsedColorParam[];
    /** Top-level param keys the system wrote itself; the rest came from `defaults`. */
    ownParams: Set<string>;
    /** Top-level param keys `defaults` writes for the system's algorithm, whether or not the system writes them too. */
    paramsInDefaults: Set<string>;
    selectorShape: SelectorShape;
    overrides: Record<string, unknown>;
    alias?: AliasValue;
    /** The selectors the system publishes whether or not a ref asks for them. */
    emit: string[];
    segments: PathSegment[];
    description?: string;
  };
  const systems = new Map<string, SystemEntry>();
  const groupDescriptions: ResolvedDefinition["groupDescriptions"] = { systems: {}, palette: {}, roles: {} };
  // A description is prose for people; anything but a string is a mistake worth naming.
  const descriptionOf = (raw: unknown, context: string): string | undefined => {
    if (raw === undefined) return undefined;
    if (typeof raw !== "string") {
      errors.push(`${context}: \`description\` is text`);
      return undefined;
    }
    return raw;
  };
  const statics: ResolvedStatic[] = [];
  const gradients: ResolvedStaticGradient[] = [];
  const writtenGradients: { path: string; segments: PathSegment[]; written: string }[] = [];
  const paletteOrder: string[] = [];
  const systemsBlock = (doc.systems ?? {}) as Record<string, unknown>;
  const systemsAlias = parseAlias(systemsBlock.alias, "systems block");

  // The palette is read first, so a system's params can name any of its
  // colors. A string is a color and any object a group; groups nest, so a
  // path is the identity.
  const paletteBlock = doc.palette ?? {};
  // `publish: false` on a group makes its colors inputs: they are published
  // only when a role points at one, since a reference always publishes what
  // it names. `emit` is the earlier spelling of `publish`, still read.
  const silent = new Set<string>();
  function walkPalette(node: Record<string, unknown>, prefix: PathSegment[], emits: boolean) {
    for (const [key, raw] of Object.entries(node)) {
      if ((key === "alias" || key === "virtual" || key === "publish" || key === "emit" || key === "description") && prefix.length > 0) continue;
      const placed = placeEntry(prefix, key);
      if ("error" in placed) {
        errors.push(`palette "${[...prefix.map((seg) => seg.name), key].join(".")}": ${placed.error}`);
        continue;
      }
      const { segments, path } = placed;
      if (typeof raw === "string") paletteOrder.push(path);
      if (typeof raw === "string" && raw.startsWith("gradient(")) {
        writtenGradients.push({ path, segments, written: raw });
        if (!emits) silent.add(path);
        continue;
      }
      if (typeof raw === "string") {
        try {
          statics.push({ path, segments, written: raw, color: parseColor(raw, `palette color "${path}"`), emitted: true });
          if (!emits) silent.add(path);
        } catch (e) {
          errors.push((e as Error).message);
        }
        continue;
      }
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`palette "${path}": expected a color or a group`);
        continue;
      }
      const block = raw as Record<string, unknown>;
      if (block.algorithm !== undefined) {
        errors.push(`palette "${path}": a palette holds colors and groups — a system goes under \`systems\``);
        continue;
      }
      const publish = publishOf(block, `palette "${path}"`);
      if (publish.error) {
        errors.push(publish.error);
        continue;
      }
      if (publish.value !== undefined && typeof publish.value !== "boolean") {
        errors.push(`palette "${path}": \`publish\` on a group is true or false`);
        continue;
      }
      if (block.virtual !== undefined && typeof block.virtual !== "boolean") {
        errors.push(`palette "${path}": \`virtual\` on a group is true or false`);
        continue;
      }
      const paletteDescription = descriptionOf(block.description, `palette "${path}"`);
      if (paletteDescription) groupDescriptions.palette[path] = paletteDescription;
      walkPalette(
        block,
        [...prefix, { name: key, alias: parseAlias(block.alias, `palette "${path}"`), virtual: block.virtual === true }],
        (publish.value as boolean | undefined) ?? emits,
      );
    }
  }
  if (typeof paletteBlock !== "object" || Array.isArray(paletteBlock)) {
    errors.push("`palette` must be a map of colors and groups");
  } else {
    walkPalette(paletteBlock as Record<string, unknown>, [], true);
  }
  const constantColors = new Map(statics.map((constant) => [constant.path, constant.color]));

  // An object with `algorithm` is a system, and any other object is a group.
  // Groups nest, so a path is the identity.
  function walkSystems(node: Record<string, unknown>, prefix: PathSegment[]) {
    for (const [key, raw] of Object.entries(node)) {
      if (key === "alias" || key === "description") continue;
      const segments = [...prefix, { name: key }];
      const path = segments.map((seg) => seg.name).join(".");
      if (typeof raw === "string") {
        errors.push(`"${path}": a color with no recipe goes under \`palette:\` now — move it there; refs to it stay as they are`);
        continue;
      }
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`"${path}": expected a group or a system`);
        continue;
      }
      const block = raw as Record<string, unknown>;
      if (block.emits !== undefined) {
        errors.push(
          `system "${path}": \`emits\` is not a key — a public name is \`alias\`, and the steps to publish are listed under \`publish\``,
        );
        continue;
      }
      const alias = parseAlias(block.alias, `"${path}"`);
      const named = [...prefix, { name: key, alias }];
      if (block.algorithm === undefined) {
        const groupDescription = descriptionOf(block.description, `"${path}"`);
        if (groupDescription) groupDescriptions.systems[path] = groupDescription;
        walkSystems(block, named);
        continue;
      }
      const algoName = String(block.algorithm);
      if (isRefFunction(path)) {
        errors.push(
          `system "${path}": that name is taken by ${path}(), ${REF_FUNCTIONS[path].is}`,
        );
        continue;
      }
      if (LITERAL_FUNCTIONS.includes(path)) {
        errors.push(
          `system "${path}": that name is taken by the ${path}() color literal`,
        );
        continue;
      }
      const renamedTo = RENAMED_ALGORITHMS[algoName];
      if (renamedTo) {
        errors.push(
          `system "${path}": \`${algoName}\` was renamed to \`${renamedTo}\``,
        );
        continue;
      }
      if (algoName === "blend" || algoName === "compose") {
        errors.push(
          `system "${path}": \`${algoName}\` is gone — a tint over a shared base does the same, one per color, in a group: \`${path}-wash: { red: { algorithm: tint, params: { base, tint } } }\`. Refs move from \`${path}(red 6)\` to \`${path}-wash.red(6)\`, and the \`alpha\` form is \`tint\``,
        );
        continue;
      }
      const algo = algorithms.get(algoName);
      if (!algo) {
        errors.push(`system "${path}": unknown algorithm "${algoName}"`);
        continue;
      }
      const stray = Object.keys(block).filter(
        (k) => !SYSTEM_RESERVED.includes(k),
      );
      if (stray.length > 0) {
        errors.push(
          `system "${path}": algorithm params moved into a \`params\` block — move ${stray.map((k) => `\`${k}\``).join(", ")} under \`params:\``,
        );
        continue;
      }
      const publish = publishOf(block, `system "${path}"`);
      if (publish.error) {
        errors.push(publish.error);
        continue;
      }
      if (publish.value !== undefined && !Array.isArray(publish.value)) {
        errors.push(`system "${path}": \`publish\` is a list of the selectors to publish, as [50, 100] or ["red 6"]`);
        continue;
      }
      const emit = ((publish.value ?? []) as unknown[]).map((selector) => String(selector).trim().split(/\s+/).join(" "));
      const paramsBlock = block.params;
      if (
        paramsBlock != null &&
        (typeof paramsBlock !== "object" || Array.isArray(paramsBlock))
      ) {
        errors.push(`system "${path}": \`params\` must be a map`);
        continue;
      }
      const writtenParams = {
        ...defaults[algoName],
        ...((paramsBlock ?? {}) as Record<string, unknown>),
      };
      if (algoName === "scale" && writtenParams.stops !== undefined) {
        errors.push(
          `system "${path}": scale's \`stops\` are gone — its selector is any stop 0–1000, \`midpoint\` shapes the curve, and the stops to publish are listed under \`publish\``,
        );
        continue;
      }
      let parsed: ReturnType<typeof parseParams>;
      let selectorShape: SelectorShape;
      try {
        parsed = parseParams(algo, writtenParams, constantColors);
        selectorShape = algo.selector(parsed.values);
      } catch (e) {
        errors.push(`system "${path}": ${(e as Error).message}`);
        continue;
      }
      systems.set(path, {
        algo,
        writtenParams,
        params: parsed.values,
        colorParams: parsed.colors,
        ownParams: new Set(Object.keys(paramsBlock ?? {})),
        paramsInDefaults: new Set(Object.keys(defaults[algoName] ?? {})),
        selectorShape,
        overrides: Object.fromEntries(
          Object.entries((block.overrides ?? {}) as Record<string, unknown>).map(([selector, color]) => [
            canonicalSelector(algo.name, selectorShape, selector),
            color,
          ]),
        ),
        alias,
        emit,
        segments: named,
        description: descriptionOf(block.description, `system "${path}"`),
      });
    }
  }
  walkSystems(systemsBlock, []);

  for (const constant of [...statics, ...writtenGradients]) {
    if (systems.has(constant.path)) {
      errors.push(`"${constant.path}" is both a palette color and a system — refs would be ambiguous`);
    }
  }

  const stepCache = new Map<string, ResolvedStep | undefined>();
  const demandedSteps = new Set<string>();
  const stepOrders = new Map<ResolvedStep, number[]>();

  function resolveStep(
    systemName: string,
    written: string,
    refContext: string,
  ): ResolvedStep | undefined {
    const sys = systems.get(systemName);
    const selector = sys ? canonicalSelector(sys.algo.name, sys.selectorShape, written) : written;
    const key = formatRef(systemName, selector);
    if (stepCache.has(key)) return stepCache.get(key);
    let step: ResolvedStep | undefined;
    if (!sys) {
      errors.push(`${refContext}: unknown system "${systemName}"`);
    } else {
      try {
        const parsed = parseSelector(
          sys.algo.name,
          sys.selectorShape,
          selector,
        );
        const generated = sys.algo.resolve(parsed.values, sys.params);
        const override = sys.overrides[selector];
        let overrideColor: Color | undefined;
        if (override != null) {
          if (!isOpaque(generated)) {
            throw new Error(
              `override "${key}": overrides pin flattened steps only; "${selector}" is translucent`,
            );
          }
          overrideColor = parseColor(override, `override "${key}"`);
          if (!isOpaque(overrideColor)) {
            throw new Error(
              `override "${key}": an override stands in for a flattened step, so it must be opaque; got ${JSON.stringify(override)}`,
            );
          }
        }
        step = {
          selector,
          publicStep: assertNameFragment(publicStepOf(parsed), key),
          color: overrideColor ?? generated,
          overridden: overrideColor != null,
          generated: overrideColor != null ? generated : undefined,
        };
        stepOrders.set(step, orderOf(sys.selectorShape, parsed));
      } catch (e) {
        errors.push(`${refContext}: ${(e as Error).message}`);
      }
    }
    stepCache.set(key, step);
    return step;
  }

  // ---- sections: every non-reserved top-level key ----
  type RawRole = {
    section: string;
    segments: PathSegment[];
    refs: (string | null)[];
    description?: string;
  };
  const sections: ResolvedSection[] = [];
  const roleIndex = new Map<string, RawRole>();
  const roleOrder: string[] = [];

  for (const [sectionName, sectionRaw] of Object.entries(doc)) {
    if (TOP_LEVEL_RESERVED.includes(sectionName)) continue;
    if (
      sectionRaw == null ||
      typeof sectionRaw !== "object" ||
      Array.isArray(sectionRaw)
    ) {
      errors.push(
        `section "${sectionName}" must be a map of groups and roles (top-level keys other than ${TOP_LEVEL_RESERVED.join("/")} are sections)`,
      );
      continue;
    }
    const sectionBlock = sectionRaw as Record<string, unknown>;
    sections.push({
      name: sectionName,
      alias: parseAlias(sectionBlock.alias, `section "${sectionName}"`),
      description: descriptionOf(sectionBlock.description, `section "${sectionName}"`),
    });

    // Roles nest as deep as the definition nests them. A node is a role when
    // it is a color, a ref list, or a block naming `refs` — the same
    // reserved-key test the systems tree uses to tell a system from a group.
    const walkRoles = (
      node: Record<string, unknown>,
      trail: PathSegment[],
    ): void => {
      for (const [name, raw] of Object.entries(node)) {
        if (name === "alias" || name === "virtual" || name === "description") continue;
        const placed = placeEntry(trail, name);
        if ("error" in placed) {
          errors.push(`${sectionName}.${[...trail.map((seg) => seg.name), name].join(".")}: ${placed.error}`);
          continue;
        }
        const { segments, path, root } = placed;
        const context = `${sectionName}.${path}`;

        let refs: (string | null)[] | undefined;
        let roleDescription: string | undefined;
        if (typeof raw === "string") {
          // A bare scalar is the whole role. Only meaningful without an axis
          // to spread across, so it is refused when one exists.
          if (!modeless) {
            errors.push(
              `${context}: expected ${modes.length} refs (one per mode: ${modes.join(", ")}), got a single value`,
            );
            continue;
          }
          refs = [raw];
        } else if (Array.isArray(raw)) {
          refs = raw.map((r) => (r == null ? null : String(r)));
        } else if (raw != null && typeof raw === "object") {
          const block = raw as Record<string, unknown>;
          if (!("refs" in block)) {
            if (root) {
              errors.push(`${context}: \`$root\` is the group's own color, a ref list, not a group`);
              continue;
            }
            if (block.virtual !== undefined && typeof block.virtual !== "boolean") {
              errors.push(`${context}: \`virtual\` on a group is true or false`);
              continue;
            }
            segments[segments.length - 1] = { name, alias: parseAlias(block.alias, context), virtual: block.virtual === true };
            const groupDescription = descriptionOf(block.description, context);
            if (groupDescription) groupDescriptions.roles[path] = groupDescription;
            walkRoles(block, segments);
            continue;
          }
          if (!root) segments[segments.length - 1] = { name, alias: parseAlias(block.alias, context) };
          roleDescription = descriptionOf(block.description, context);
          if (!Array.isArray(block.refs)) {
            errors.push(`${context}: expected a \`refs\` list`);
            continue;
          }
          refs = block.refs.map((r) => (r == null ? null : String(r)));
        } else if (raw == null) {
          errors.push(
            `${context}: is empty — an unquoted # starts a YAML comment; quote the color, as "#000000"`,
          );
          continue;
        } else {
          errors.push(
            modeless
              ? `${context}: a role is a color, a ref list, { refs, alias?, description? }, or a group of roles`
              : `${context}: a role is a ref list, { refs, alias?, description? }, or a group of roles`,
          );
          continue;
        }

        if (segments.every((seg) => seg.virtual)) {
          errors.push(`${context}: every segment is virtual — nothing left to name`);
        }
        if (roleIndex.has(path)) {
          errors.push(
            `role path "${path}" appears in more than one section — refs would be ambiguous`,
          );
          continue;
        }
        roleIndex.set(path, { section: sectionName, segments, refs, description: roleDescription });
        roleOrder.push(path);
      }
    };
    walkRoles(sectionBlock, []);
  }

  for (const constant of [...statics, ...writtenGradients]) {
    if (roleIndex.has(constant.path)) {
      errors.push(
        `"${constant.path}" is both a constant and a role path — refs would be ambiguous`,
      );
    }
  }

  // ---- role resolution ----
  const roleCache = new Map<string, ResolvedRole | undefined>();

  function resolveRole(
    path: string,
    stack: string[],
  ): ResolvedRole | undefined {
    if (roleCache.has(path)) return roleCache.get(path);
    if (stack.includes(path)) {
      errors.push(`circular role reference: ${[...stack, path].join(" → ")}`);
      return undefined;
    }
    const raw = roleIndex.get(path);
    if (raw === undefined) {
      errors.push(`${stack.at(-1) ?? "?"}: unknown role "${path}"`);
      roleCache.set(path, undefined);
      return undefined;
    }
    if (raw.refs.length > modes.length || raw.refs.length <= lastRootIndex) {
      const expected =
        lastRootIndex + 1 === modes.length
          ? `${modes.length} refs (one per mode)`
          : `${lastRootIndex + 1} to ${modes.length} refs (one per mode; a mode that extends another may be left off the end)`;
      errors.push(
        `${path}: expected ${expected}, got ${raw.refs.length}${
          raw.refs.some(
            (r) => r != null && /^transparent\(/.test(r) && !r.endsWith(")"),
          )
            ? " — a comma inside a `[ ]` list separates items. transparent() takes a space: transparent(shade 70)."
            : ""
        }`,
      );
      roleCache.set(path, undefined);
      return undefined;
    }

    // A mode that says nothing takes the ref of the mode it extends, resolved
    // again in its own mode — so a role pointing at `surface.card` follows
    // whatever this mode made of `surface.card`. perMode carries a value for
    // every mode regardless, because a consumer that cannot express absence —
    // Figma has no unset mode, it fills one with white — needs a color to
    // write. `inherited` records which were never declared, so the formats
    // that *can* leave a mode out do.
    const perMode: ResolvedRef[] = [];
    const inherited: boolean[] = [];
    for (let i = 0; i < modes.length; i++) {
      let source = i;
      while (raw.refs[source] == null && parentIndex[source] !== undefined) {
        source = parentIndex[source]!;
      }
      const ref = raw.refs[source];
      if (ref == null) {
        if (source === i) {
          errors.push(
            `${path}: mode "${modes[i]}" is \`~\` but extends nothing — \`~\` stands for a mode that \`extends\` another and takes that mode's ref`,
          );
        }
        continue;
      }
      const context = `${path}[${modes[i]}]`;
      const resolved = resolveRef(ref, i, context, [...stack, path]);
      if (resolved) {
        perMode.push(resolved);
        inherited.push(source !== i);
      }
    }

    const complete = perMode.length === modes.length;
    if (complete && mixesKinds(perMode)) {
      problems.push({
        path,
        message: "A role must be all solid colors or all gradients.",
      });
    }
    const resolvedRole: ResolvedRole = {
      section: raw.section,
      segments: raw.segments,
      // Derived from segments, for callers that want "the last bit" and
      // "everything above it" — the dev server and the lineage index.
      group: raw.segments.slice(0, -1).map((seg) => seg.name).join("."),
      role: raw.segments[raw.segments.length - 1].name,
      description: raw.description,
      perMode,
      inherited,
    };
    roleCache.set(path, complete ? resolvedRole : undefined);
    return complete ? resolvedRole : undefined;
  }

  function resolveRef(
    ref: string,
    modeIndex: number,
    context: string,
    stack: string[],
    demands = true,
  ): ResolvedRef | undefined {
    const call = parseCall(ref);
    if (call && call.selector.includes(",")) {
      errors.push(`${context}: "${ref}" separates with a comma — write spaces, as ${spacedSpelling(call.name, call.selector)}`);
      return undefined;
    }
    if (ref.startsWith("#") || LITERAL_FUNCTIONS.includes(call?.name ?? "")) {
      try {
        return { kind: "color", ref, target: { kind: "literal" }, color: parseColor(ref, context) };
      } catch (error) {
        errors.push((error as Error).message);
        return undefined;
      }
    }
    const gradient = /^gradient\((.*)\)$/s.exec(ref);
    if (gradient) return resolveGradient(ref, gradient[1], modeIndex, context, stack, demands);
    const faded = /^transparent\(\s*(.+?)\s+(\S+)\s*\)$/.exec(ref);
    if (faded) {
      const [, inner, weight] = faded;
      if (inner.includes(" ") && !inner.includes("(")) {
        errors.push(`${context}: ${TRANSPARENT_USAGE}`);
        return undefined;
      }
      const alpha = Number(weight);
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 100) {
        errors.push(
          `${context}: transparent() opacity must be a number 0-100, got "${weight}"`,
        );
        return undefined;
      }
      const of = resolveArgument("transparent", inner, modeIndex, context, stack, false);
      if (!of) return undefined;
      const target: RefTarget = { kind: "transparent", of: of.target, alpha };
      const atOpacity = (color: ResolvedColorRef): ResolvedColorRef => ({
        kind: "color",
        ref: color.ref,
        target: { kind: "transparent", of: color.target, alpha },
        color: { ...color.color, alpha: color.color.alpha * (alpha / 100) },
      });
      return of.kind === "color"
        ? { ...atOpacity(of), ref, target }
        : {
            ...of,
            ref,
            target,
            stops: of.stops.map((stop) => ({ color: atOpacity(stop.color), position: stop.position })),
          };
    }
    if (call?.name === "transparent") {
      errors.push(`${context}: ${TRANSPARENT_USAGE}`);
      return undefined;
    }
    if (call) {
      const step = resolveStep(call.name, call.selector, context);
      if (!step) return undefined;
      if (demands) demandedSteps.add(formatRef(call.name, step.selector));
      return {
        kind: "color",
        ref,
        target: { kind: "step", system: call.name, selector: step.selector },
        color: step.color,
      };
    }
    if (ref.startsWith("transparent(") && ref.endsWith(")")) {
      errors.push(`${context}: ${TRANSPARENT_USAGE}`);
      return undefined;
    }
    if (ref.includes("/")) {
      const slash = ref.indexOf("/");
      const selector = ref.slice(slash + 1).replace(/[@/]/g, " ");
      errors.push(
        `${context}: "${ref}" is the old spelling — write ${formatRef(ref.slice(0, slash), selector)}`,
      );
      return undefined;
    }
    if (ref === ROOT || ref.endsWith(`.${ROOT}`)) {
      errors.push(`${context}: a group's own color is pointed at by the group's path — write ${ref.slice(0, -ROOT.length - 1) || "the group"}`);
      return undefined;
    }
    if (roleIndex.has(ref)) {
      const targetRole = resolveRole(ref, stack);
      const entry = targetRole?.perMode[modeIndex];
      if (!targetRole || !entry) return undefined;
      const target: RefTarget = { kind: "role", group: targetRole.group, role: targetRole.role };
      return entry.kind === "gradient"
        ? { ...entry, ref, target }
        : { kind: "color", ref, target, color: entry.color };
    }
    const namedGradient = gradients.find((candidate) => candidate.path === ref);
    if (namedGradient) {
      return { ...namedGradient.gradient, ref, target: { kind: "constant", name: ref } };
    }
    const constant = statics.find((s) => s.path === ref);
    if (constant) {
      return {
        kind: "color",
        ref,
        target: { kind: "constant", name: ref },
        color: constant.color,
      };
    }
    if (ref.includes("(") && !ref.endsWith(")")) {
      errors.push(
        `${context}: "${ref}" was cut short — a comma inside a \`[ ]\` list separates items, and an unquoted # after a space starts a YAML comment. Separate with spaces, as transparent(paper 70), and quote a ref that holds a hex color, as "gradient(paper #000000)".`,
      );
      return undefined;
    }
    if (/^[^\s()]+\)$/.test(ref)) {
      errors.push(
        `${context}: "${ref}" is the tail of a ref split by a comma inside a \`[ ]\` list — separate with spaces, as transparent(paper 70).`,
      );
      return undefined;
    }
    errors.push(
      `${context}: unrecognized ref "${ref}" — expected system(selector), group.role, a declared constant, a color, or transparent(...)`,
    );
    return undefined;
  }

  /** A ref where only a color will do: a gradient there is refused, naming what asked. */
  /** A ref handed to `fn`, as one of the kinds `fn` declares it accepts; any other kind is refused by name. */
  function resolveArgument<F extends RefFunction>(
    fn: F,
    ref: string,
    modeIndex: number,
    context: string,
    stack: string[],
    demands: boolean,
  ): Accepted<F> | undefined {
    const resolved = resolveRef(ref, modeIndex, context, stack, demands);
    if (!resolved) return undefined;
    if (!accepts(fn, resolved)) {
      errors.push(`${context}: ${ref} is a ${resolved.kind} — ${fn}() takes ${acceptedBy(fn)}`);
      return undefined;
    }
    return resolved;
  }

  function resolveGradient(
    ref: string,
    inside: string,
    modeIndex: number,
    context: string,
    stack: string[],
    demands: boolean,
  ): ResolvedGradientRef | undefined {
    const refuse = (message: string) => {
      errors.push(`${context}: gradient() ${message}`);
      return undefined;
    };
    if (inside.includes(",")) {
      errors.push(
        `${context}: "${ref}" separates with a comma — write spaces, as gradient(paper 0% shade 100% angle=90deg)`,
      );
      return undefined;
    }
    const args = splitArguments("gradient", wordsOutsideParens(inside));
    if ("error" in args) {
      errors.push(`${context}: ${args.error}`);
      return undefined;
    }
    const { positional, named } = args;
    const leadingAngle = positional.find((word) => /^-?[\d.]+deg$/.test(word));
    if (leadingAngle) {
      return refuse(
        `takes its angle as a named argument, after the colors — write angle=${leadingAngle}, as gradient(paper shade angle=${leadingAngle})`,
      );
    }

    const stops: GradientStop[] = [];
    let restyled: ResolvedGradientRef | null = null;
    let failed = false;
    for (const word of positional) {
      if (word !== "" && Number.isFinite(Number(word))) {
        return refuse(
          `got the bare number ${word} — a position is written ${word}% and follows its color, and the angle is written angle=${word}deg after the colors`,
        );
      }
      if (word.endsWith("%")) {
        const position = Number(word.slice(0, -1));
        const stop = stops.at(-1);
        if (!Number.isFinite(position) || word.length === 1) {
          return refuse(`position must be a number, as 50%, got "${word}"`);
        }
        if (!stop || stop.position != null) {
          return refuse(`position ${word} has no color before it — a position follows its color, one each`);
        }
        stop.position = position;
        continue;
      }
      const argument = resolveArgument("gradient", word, modeIndex, context, stack, demands);
      if (!argument) {
        failed = true;
        continue;
      }
      if (argument.kind === "gradient") {
        if (positional.length > 1) {
          return refuse(
            `got ${word} as a stop, and it is a gradient — a stop is a color; to restyle a gradient, give it alone, as gradient(${word} angle=90deg)`,
          );
        }
        restyled = argument;
        continue;
      }
      stops.push({ color: argument, position: null });
    }
    if (failed) return undefined;
    if (!restyled && stops.length === 1) {
      return refuse(`takes at least two colors, or one gradient to restyle — ${stops[0].color.ref} is a color`);
    }
    if (!restyled && stops.length < 2) {
      return refuse(`takes at least two colors, as gradient(paper shade angle=90deg)`);
    }

    // Restyling keeps what is not named: the stops always, and the rest
    // while the kind is still the one those arguments belong to.
    const oneOf = <T extends string>(name: string, options: readonly T[], fallback: T): T | undefined => {
      const value = named.get(name);
      if (value == null) return fallback;
      return (options as readonly string[]).includes(value) ? (value as T) : undefined;
    };
    const kind = oneOf("kind", ["linear", "radial", "conic"], restyled?.geometry.kind ?? "linear");
    if (!kind) return refuse(`kind must be linear, radial or conic, got "${named.get("kind")}"`);
    const misplaced = [...named.keys()].find(
      (name) => !["kind", "repeat", "space", ...GEOMETRY_ARGUMENTS[kind]].includes(name),
    );
    if (misplaced) {
      const kinds = Object.entries(GEOMETRY_ARGUMENTS).filter(([, names]) => names.includes(misplaced)).map(([name]) => name);
      return refuse(`takes ${misplaced} when kind is ${kinds.join(" or ")}, and this one is ${kind}`);
    }
    const kept = restyled?.geometry.kind === kind ? restyled.geometry : null;
    const measure = (name: string, unit: string, fallback: number): number | undefined => {
      const value = named.get(name);
      if (value == null) return fallback;
      const number = value.endsWith(unit) && /^-?[\d.]+$/.test(value.slice(0, -unit.length)) ? Number(value.slice(0, -unit.length)) : NaN;
      return Number.isFinite(number) ? number : undefined;
    };
    const angle = measure("angle", "deg", kept && "angle" in kept ? kept.angle : kind === "conic" ? 0 : 180);
    if (angle == null) return refuse(`angle must be a number of degrees, as angle=90deg, got "${named.get("angle")}"`);
    const x = measure("x", "%", kept && "x" in kept ? kept.x : 50);
    const y = measure("y", "%", kept && "y" in kept ? kept.y : 50);
    if (x == null || y == null) {
      return refuse(`x and y are percents, as x=30% y=20%, got "${named.get(x == null ? "x" : "y")}"`);
    }
    const shape = oneOf("shape", RADIAL_SHAPES, kept?.kind === "radial" ? kept.shape : "ellipse");
    if (!shape) return refuse(`shape must be ${RADIAL_SHAPES.join(" or ")}, got "${named.get("shape")}"`);
    const size = oneOf("size", RADIAL_SIZES, kept?.kind === "radial" ? kept.size : "farthest-corner");
    if (!size) return refuse(`size must be one of ${RADIAL_SIZES.join(", ")}, got "${named.get("size")}"`);
    const repeat = oneOf("repeat", ["true", "false"], restyled?.repeat ? "true" : "false");
    if (!repeat) return refuse(`repeat is true or false, got "${named.get("repeat")}"`);
    const space = named.has("space") ? oneOf("space", GRADIENT_SPACES, "srgb") : (restyled?.space ?? null);
    if (space === undefined) return refuse(`space must be one of ${GRADIENT_SPACES.join(", ")}, got "${named.get("space")}"`);
    const geometry: GradientGeometry =
      kind === "linear" ? { kind, angle } : kind === "radial" ? { kind, shape, size, x, y } : { kind, angle, x, y };
    return {
      kind: "gradient",
      ref,
      target: { kind: "gradient", of: restyled?.target ?? null },
      geometry,
      repeat: repeat === "true",
      space,
      stops: restyled?.stops ?? stops,
    };
  }

  // The palette is read before systems and roles, so its gradients hold
  // only what it has itself: its colors, and colors written out. That also
  // leaves nothing for one to loop back through.
  for (const { path, segments, written } of writtenGradients) {
    const context = `palette gradient "${path}"`;
    const gradient = resolveRef(written, 0, context, [], false);
    if (!gradient || gradient.kind !== "gradient") continue;
    const foreign = gradient.stops.find((stop) => !["constant", "literal"].includes(throughTransparent(stop.color.target).kind));
    if (foreign || gradient.target.kind !== "gradient" || gradient.target.of) {
      errors.push(
        `${context}: ${foreign ? foreign.color.ref : written} is not the palette's own — a palette gradient holds palette colors and colors written out; build one from a step, a role or another gradient in a role`,
      );
      continue;
    }
    gradients.push({ path, segments, written, gradient, emitted: true });
  }

  const roles: ResolvedRole[] = [];
  for (const path of roleOrder) {
    const resolved = resolveRole(path, []);
    if (resolved) roles.push(resolved);
  }
  const constantsNamedBy = (entries: ResolvedRef[]) =>
    entries.flatMap((entry) => [entry, ...colorRefsOf(entry)]).flatMap((entry) => (entry.target.kind === "constant" ? [entry.target.name] : []));
  const pointedAt = new Set(constantsNamedBy(roles.flatMap((role) => role.perMode)));
  for (const gradient of gradients) {
    gradient.emitted = !silent.has(gradient.path) || pointedAt.has(gradient.path);
  }
  for (const name of constantsNamedBy(gradients.filter((gradient) => gradient.emitted).map((gradient) => gradient.gradient))) {
    pointedAt.add(name);
  }
  for (const constant of statics) {
    constant.emitted = !silent.has(constant.path) || pointedAt.has(constant.path);
  }

  const resolvedSystems: ResolvedSystem[] = [];
  for (const [name, sys] of systems) {
    // What a system publishes is what its `publish` lists plus what refs demand.
    for (const selector of sys.emit) {
      const step = resolveStep(name, selector, `system "${name}" publish`);
      if (step) demandedSteps.add(formatRef(name, step.selector));
    }
    const steps = [...stepCache.entries()]
      .filter(([key, step]) => step != null && demandedSteps.has(key) && key.startsWith(`${name}(`))
      .map(([, step]) => step as ResolvedStep)
      .map((step) => ({ step, order: stepOrders.get(step) ?? [] }))
      .sort(compareSteps)
      .map((ordered) => ordered.step);
    const emitted = new Set(steps.map((s) => s.selector));
    for (const selector of Object.keys(sys.overrides)) {
      if (!emitted.has(selector)) {
        warnings.push(
          `override "${formatRef(name, selector)}" pins a step nothing demands — it emits nothing`,
        );
      }
    }
    const colorParams: ResolvedColorParam[] = sys.colorParams.map((param) => ({
      ...param,
      from: sys.ownParams.has(param.path.split(".")[0]) ? "system" : "defaults",
    }));
    resolvedSystems.push({
      system: name,
      segments: sys.segments,
      alias: sys.alias,
      algorithm: sys.algo.name,
      algorithmDescription: sys.algo.description,
      // In the order the algorithm declares them, not the order `defaults` and the system's own block merged in.
      params: Object.fromEntries(
        Object.entries(sys.algo.params)
          .filter(([key, kind]) => key in sys.writtenParams || ("default" in kind && kind.default !== undefined))
          .map(([key, kind]) => [key, key in sys.writtenParams ? sys.writtenParams[key] : "default" in kind ? kind.default : undefined]),
      ),
      ownParams: [...sys.ownParams],
      paramsInDefaults: [...sys.paramsInDefaults],
      defaultedParams: Object.keys(sys.algo.params).filter((key) => !(key in sys.writtenParams)),
      curves: curvesOf(sys.algo, sys.params, sys.selectorShape, steps),
      colorParams,
      selector: sys.selectorShape,
      steps,
      emit: sys.emit,
      description: sys.description,
    });
  }

  // ---- public-name uniqueness (aliases and omissions can collide) ----
  for (const target of ["css", "figma"]) {
    const claimer = () => {
      const seen = new Map<string, string>();
      return (name: string, owner: string) => {
        const prior = seen.get(name);
        if (prior) {
          errors.push(`${target} name collision: "${name}" is emitted by both ${prior} and ${owner}`);
        } else {
          seen.set(name, owner);
        }
      };
    };
    const claim = claimer();
    // In Figma the palette is a group of its own, apart from every collection of roles.
    const claimPalette = target === "css" ? claim : claimer();
    for (const constant of [...statics, ...gradients]) {
      if (constant.emitted) claimPalette(publicPath(constant.segments, target, target === "css" ? "-" : "/"), constant.path);
    }
    // Primitives and roles share css names: tailwind wires each role in as --color-<role>.
    if (target === "css") {
      for (const system of resolvedSystems) {
        for (const step of system.steps) {
          claim(`${publicSystemName(system, "css")}-${step.publicStep}`, formatRef(system.system, step.selector));
        }
      }
    }
    for (const role of roles) {
      const scope =
        target === "figma"
          ? `${aliasedName(sections.find((s) => s.name === role.section)?.alias, target, role.section)}/`
          : "";
      claim(scope + publicPath(role.segments, target, target === "css" ? "-" : "/"), rolePath(role));
    }
  }

  // Every system's steps are gathered above, so a probe landing in the step
  // cache from here on cannot make itself demanded.
  const probed: Probe[] = probes.map((ref) => {
    const call = parseCall(ref);
    if (!call) return { ref, error: `"${ref}" is not a ref into a system` };
    const errorsBefore = errors.length;
    const step = resolveStep(call.name, call.selector, `probe "${ref}"`);
    const failures = errors.splice(errorsBefore);
    return step ? { ref, color: step.color } : { ref, error: failures.join("; ") };
  });

  // The project's gamut is a ceiling on what is authored, not a clamp: a
  // color above it resolves and emits untouched, and this only says so.
  for (const constant of statics) {
    if (needsMapping(constant.color, gamut)) {
      warnings.push(
        `constant "${constant.path}" is outside ${gamut}, the project's gamut`,
      );
    }
  }
  for (const system of resolvedSystems) {
    for (const param of system.colorParams) {
      if (needsMapping(param.color, gamut)) {
        warnings.push(
          `system "${system.system}" param \`${param.path}\` is outside ${gamut}, the project's gamut`,
        );
      }
    }
  }

  const constantByValue = new Map(
    statics.map((constant) => [formatAuthored(toOklab(constant.color), constant.color.alpha), constant.path]),
  );
  const literalUses = new Map<string, { ref: string; places: string[] }>();
  for (const role of roles) {
    const rolePath = role.segments.map((seg) => seg.name).join(".");
    role.perMode.forEach((roleEntry, i) => {
      if (role.inherited[i]) return;
      const place = `${rolePath}[${modes[i]}]`;
      for (const entry of colorRefsOf(roleEntry)) {
        if (entry.target.kind !== "literal") continue;
        if (needsMapping(entry.color, gamut)) {
          warnings.push(`${place}: ${entry.ref} is outside ${gamut}, the project's gamut`);
        }
        const value = formatAuthored(toOklab(entry.color), entry.color.alpha);
        const constant = constantByValue.get(value);
        if (constant) {
          warnings.push(`${place}: ${entry.ref} is the constant \`${constant}\` — point at it`);
          continue;
        }
        const uses = literalUses.get(value) ?? { ref: entry.ref, places: [] };
        uses.places.push(place);
        literalUses.set(value, uses);
      }
    });
  }
  for (const { ref, places } of literalUses.values()) {
    if (places.length > 1) {
      warnings.push(`${ref} is written in ${places.join(" and ")} — name it in the palette`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`definition errors:\n- ${errors.join("\n- ")}`);
  }

  return {
    modes,
    modeDetails,
    changelog,
    systems: resolvedSystems,
    systemsAlias,
    statics,
    gradients,
    paletteOrder,
    sections,
    roles,
    groupDescriptions,
    warnings,
    problems,
    probed,
  };
}
