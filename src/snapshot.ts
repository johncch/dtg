import { parseColor, toOklab, type Color, type Gamut } from "./color-math.js";
import type { SelectorShape } from "./contract.js";
import type { BackgroundOverrides } from "./dev-settings.js";
import { parseDocument } from "yaml";
import { anchorsOf, type Edit, type ParamAnchor } from "./edit.js";
import type { Change } from "./working-copy.js";
import {
  algorithmFor,
  publicPath,
  publicSystemName,
  type Lineage,
  type RefTarget,
  type ResolvedColorParam,
  type ResolvedCurve,
  type ResolvedDefinition,
  type ModeScheme,
} from "./resolve.js";
import { formatRef, parseCall, rolePath } from "./selector.js";

/**
 * Everything the browser needs to draw the definition, as plain JSON. The
 * browser formats colors itself with color-math; what it cannot do is run an
 * algorithm or apply an alias, so anything that needs either arrives here
 * already worked out.
 */
export type Snapshot = {
  /** Set when the last re-resolve failed; the rest is the previous good state. */
  error: string | null;
  /** dtg itself was rebuilt since the server started. */
  stale: boolean;
  /** The project's gamut: the widest colors the picker offers. */
  gamut: Gamut;
  /** What saving would write: every color whose working value differs from the file's. */
  changes: Change[];
  /** The step undo would take back and the one redo would bring back, or null when there is none. */
  undo: Edit[] | null;
  redo: Edit[] | null;
  definition: SnapshotDefinition;
  /** The full path of the `dtg.config.yaml` the settings are kept in, whether or not it exists yet. */
  configPath: string;
  /** The page colors the app can be looked at against: one per distinct mode background. Never empty. */
  backgrounds: SnapshotBackground[];
  modes: string[];
  /** Index-parallel to `modes`. */
  modeDetails: SnapshotMode[];
  warnings: string[];
  systems: SnapshotSystem[];
  constants: SnapshotConstant[];
  roles: SnapshotRole[];
  /** Hand-written descriptions of groups, by dotted path: system groups, palette groups, and role groups. */
  groupNotes: { systems: Record<string, string>; palette: Record<string, string>; roles: Record<string, string> };
};

export type SnapshotDefinition = {
  /** The definition file's full path. */
  path: string;
  /** The file with unsaved changes applied: what the rest of the snapshot was resolved from. */
  text: string;
};

export type SnapshotMode = {
  name: string;
  /** The mode this one falls back to, or null for a root. */
  extends: string | null;
  scheme: ModeScheme;
  /** The definition never said, so the scheme was guessed from the mode's colors. */
  schemeInferred: boolean;
  /** As `editor.backgrounds` has it, or the scheme's default: a color or a ref. */
  backgroundWritten: string;
  /** What `backgroundWritten` comes to in this mode, or the scheme's default when it comes to nothing. */
  background: Color;
  /** Set by hand in `editor.backgrounds` rather than implied by the scheme. */
  backgroundOverridden: boolean;
  /** Why `backgroundWritten` could not be shown, or null when it was. */
  backgroundProblem: string | null;
};

/** One sidebar swatch: a color and the modes seen on it. */
export type SnapshotBackground = {
  modes: string[];
  /** As `editor.backgrounds` has it, or would: hex or `oklch()`. */
  written: string;
  color: Color;
};

const SCHEME_BACKGROUND: Record<ModeScheme, string> = { light: "#ffffff", dark: "#000000" };

/** OKLab lightness at which a mode's colors, taken together, read as a light scheme. */
const LIGHT_FROM = 0.6;

/** The median lightness of the mode's opaque role colors, light at 0.6 and above. Light when there is nothing to go on. */
function inferScheme(resolved: ResolvedDefinition, modeIndex: number): ModeScheme {
  const lightness = resolved.roles
    .map((role) => role.perMode[modeIndex].color)
    .filter((color) => color.alpha === 1)
    .map((color) => toOklab(color)[0])
    .sort((a, b) => a - b);
  if (lightness.length === 0) return "light";
  return lightness[Math.floor(lightness.length / 2)] >= LIGHT_FROM ? "light" : "dark";
}

function sameColor(a: Color, b: Color): boolean {
  if (a.alpha !== b.alpha) return false;
  const [la, aa, ba] = toOklab(a);
  const [lb, ab, bb] = toOklab(b);
  return la === lb && aa === ab && ba === bb;
}

/**
 * What a background value comes to in one mode: a color as written, a
 * constant, a role in that mode, or a system step the resolver was asked to
 * probe. Throws with the reason when it comes to nothing.
 */
export function resolveBackground(written: string, resolved: ResolvedDefinition, modeIndex: number): Color {
  const constant = resolved.statics.find((candidate) => candidate.path === written);
  if (constant) return constant.color;
  const role = resolved.roles.find((candidate) => rolePath(candidate) === written);
  if (role) return role.perMode[modeIndex].color;
  if (parseCall(written)) {
    const probe = resolved.probed.find((candidate) => candidate.ref === written);
    if (!probe) throw new Error(`"${written}" was not resolved`);
    if ("error" in probe) throw new Error(probe.error);
    return probe.color;
  }
  return parseColor(written, "background");
}

/** The step refs among `overrides`, for the resolver to probe so they resolve without a role demanding them. */
export function backgroundProbes(overrides: BackgroundOverrides): string[] {
  return Object.values(overrides).filter((written) => parseCall(written) !== null);
}

function modeDetailsOf(resolved: ResolvedDefinition, overrides: BackgroundOverrides): SnapshotMode[] {
  return resolved.modeDetails.map((mode, index) => {
    const scheme = mode.scheme ?? inferScheme(resolved, index);
    const overridden = mode.name in overrides;
    const backgroundWritten = overridden ? overrides[mode.name] : SCHEME_BACKGROUND[scheme];
    let background: Color;
    let backgroundProblem: string | null = null;
    try {
      background = resolveBackground(backgroundWritten, resolved, index);
    } catch (e) {
      background = parseColor(SCHEME_BACKGROUND[scheme], "background");
      backgroundProblem = (e as Error).message;
    }
    return {
      name: mode.name,
      extends: mode.extends ?? null,
      scheme,
      schemeInferred: mode.scheme === undefined,
      backgroundWritten,
      background,
      backgroundOverridden: overridden,
      backgroundProblem,
    };
  });
}

function backgroundsOf(modeDetails: SnapshotMode[]): SnapshotBackground[] {
  const backgrounds: SnapshotBackground[] = [];
  for (const mode of modeDetails) {
    const same = backgrounds.find((background) => sameColor(background.color, mode.background));
    if (same) same.modes.push(mode.name);
    else backgrounds.push({ modes: [mode.name], written: mode.backgroundWritten, color: mode.background });
  }
  return backgrounds;
}

export type SnapshotUse = {
  section: string;
  group: string;
  role: string;
  mode: string;
  translucent: boolean;
};

export type SnapshotStep = {
  selector: string;
  publicStep: string;
  color: Color;
  /** What the algorithm produced, present only when an override won. */
  generated: Color | null;
  usedBy: SnapshotUse[];
};

export type SnapshotSystem = {
  /** Internal dotted path — the stable identity refs point at. */
  system: string;
  cssName: string;
  algorithm: string;
  description: string;
  params: Record<string, unknown>;
  /** The system's hand-written description, or null; `description` is the algorithm's. */
  note: string | null;
  /** The top-level params the system wrote itself. */
  ownParams: string[];
  /** The params nothing writes; their value in `params` is the algorithm's default, and setting one writes it into the system. */
  defaultedParams: string[];
  /** Each `curve` param, every field filled in, with its pivot and bounds, for the page to draw and edit. */
  curves: Record<string, ResolvedCurve>;
  /** The bounds the algorithm declares for its number params, by name, for a slider to run between. */
  numberRanges: Record<string, { min: number; max: number }>;
  /** The options the algorithm declares for its choice params, by name, for a control to pick among. */
  choices: Record<string, string[]>;
  /** The system's own params that carry a YAML anchor others share, or are an alias of one, by name. */
  anchors: Record<string, ParamAnchor>;
  /** Which of `params` are colors, so the page knows what can be edited. */
  colorParams: ResolvedColorParam[];
  /** What a ref into this system is made of, so the page can draw a control for each part. */
  selector: SelectorShape;
  steps: SnapshotStep[];
};

export type SnapshotConstant = {
  path: string;
  cssName: string;
  /** False for an input: its group is `emit: false` and no role points at it. */
  emitted: boolean;
  /** The color as the definition writes it, which an editor opens on. */
  written: string;
  color: Color;
  usedBy: SnapshotUse[];
  /** The system params that name it, as `{ system, param }`. */
  paramOf: { system: string; param: string }[];
};

export type SnapshotRole = {
  section: string;
  group: string;
  role: string;
  /** The role's hand-written description, or null. */
  note: string | null;
  /**
   * One entry per mode, in `modes` order. `inherited` = the role wrote
   * nothing for this mode and the ref is the one of the mode it extends.
   */
  perMode: { ref: string; target: RefTarget; color: Color; inherited: boolean }[];
};

export function buildSnapshot({
  resolved,
  lineage,
  error,
  stale,
  gamut,
  changes,
  undo = null,
  redo = null,
  definition,
  configPath = "dtg.config.yaml",
  backgroundOverrides = {},
}: {
  resolved: ResolvedDefinition;
  lineage: Lineage;
  error: string | null;
  stale: boolean;
  gamut: Gamut;
  changes: Change[];
  undo?: Edit[] | null;
  redo?: Edit[] | null;
  definition: SnapshotDefinition;
  configPath?: string;
  backgroundOverrides?: BackgroundOverrides;
}): Snapshot {
  const document = parseDocument(definition.text);
  const modeDetails = modeDetailsOf(resolved, backgroundOverrides);
  const backgroundWarnings = [
    ...Object.keys(backgroundOverrides)
      .filter((mode) => !resolved.modes.includes(mode))
      .map((mode) => `editor.backgrounds: no mode named ${JSON.stringify(mode)}`),
    ...modeDetails
      .filter((mode) => mode.backgroundProblem !== null)
      .map((mode) => `editor.backgrounds.${mode.name}: ${mode.backgroundProblem}`),
  ];
  return {
    error,
    stale,
    gamut,
    changes,
    undo,
    redo,
    definition,
    configPath,
    backgrounds: backgroundsOf(modeDetails),
    modes: resolved.modes,
    modeDetails,
    warnings: [...resolved.warnings, ...backgroundWarnings],
    systems: resolved.systems.map((system) => ({
      system: system.system,
      cssName: publicSystemName(system, "css"),
      algorithm: system.algorithm,
      description: system.algorithmDescription,
      params: system.params,
      note: system.description ?? null,
      ownParams: system.ownParams,
      defaultedParams: system.defaultedParams,
      curves: system.curves,
      numberRanges: numberRangesOf(system.algorithm),
      choices: choicesOf(system.algorithm),
      anchors: anchorsOf(document, system.system),
      colorParams: system.colorParams,
      selector: system.selector,
      steps: system.steps.map((step) => ({
        selector: step.selector,
        publicStep: step.publicStep,
        color: step.color,
        generated: step.generated ?? null,
        usedBy: lineage.get(formatRef(system.system, step.selector)) ?? [],
      })),
    })),
    constants: resolved.statics.map((constant) => ({
      path: constant.path,
      cssName: publicPath(constant.segments, "css", "-"),
      emitted: constant.emitted,
      written: constant.written,
      color: constant.color,
      usedBy: lineage.get(constant.path) ?? [],
      paramOf: resolved.systems.flatMap((system) =>
        system.colorParams
          .filter((param) => param.constant === constant.path)
          .map((param) => ({ system: system.system, param: param.path })),
      ),
    })),
    groupNotes: resolved.groupDescriptions,
    roles: resolved.roles.map((role) => ({
      section: role.section,
      group: role.group,
      role: role.role,
      note: role.description ?? null,
      perMode: role.perMode.map((entry, index) => ({
        ref: entry.ref,
        target: entry.target,
        color: entry.color,
        inherited: role.inherited[index],
      })),
    })),
  };
}

function choicesOf(algorithm: string): Record<string, string[]> {
  const params = algorithmFor(algorithm)?.params ?? {};
  return Object.fromEntries(
    Object.entries(params).flatMap(([name, kind]) => (kind.kind === "choice" ? [[name, kind.options]] : [])),
  );
}

function numberRangesOf(algorithm: string): Record<string, { min: number; max: number }> {
  const params = algorithmFor(algorithm)?.params ?? {};
  return Object.fromEntries(
    Object.entries(params).flatMap(([name, kind]) =>
      kind.kind === "number" && kind.min != null && kind.max != null ? [[name, { min: kind.min, max: kind.max }]] : [],
    ),
  );
}
