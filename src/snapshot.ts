import { parseColor, type Color, type Gamut } from "./color-math.js";
import type { SelectorShape } from "./contract.js";
import { DEFAULT_BACKGROUNDS, type Background } from "./dev-settings.js";
import type { Edit } from "./edit.js";
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
} from "./resolve.js";
import { formatRef } from "./selector.js";

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
  /** The page colors the app can be looked at against. Never empty. */
  backgrounds: SnapshotBackground[];
  modes: string[];
  /** Index-parallel to `modes`: the mode each one extends, or null for a root. */
  modeParents: (string | null)[];
  warnings: string[];
  systems: SnapshotSystem[];
  constants: SnapshotConstant[];
  roles: SnapshotRole[];
  /** Hand-written descriptions of groups, by dotted path: system groups, palette groups, and role domains. */
  groupNotes: { systems: Record<string, string>; palette: Record<string, string>; roles: Record<string, string> };
};

export type SnapshotDefinition = {
  /** The definition file's full path. */
  path: string;
  /** The file with unsaved changes applied: what the rest of the snapshot was resolved from. */
  text: string;
};

export type SnapshotBackground = {
  name: string;
  /** As `dtg.config.yaml` has it, or would: hex or `oklch()`. */
  written: string;
  color: Color;
};

export type SnapshotUse = {
  domain: string;
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
  color: Color;
  usedBy: SnapshotUse[];
  /** The system params that name it, as `{ system, param }`. */
  paramOf: { system: string; param: string }[];
};

export type SnapshotRole = {
  section: string;
  domain: string;
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
  backgrounds = DEFAULT_BACKGROUNDS,
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
  backgrounds?: Background[];
}): Snapshot {
  return {
    error,
    stale,
    gamut,
    changes,
    undo,
    redo,
    definition,
    configPath,
    backgrounds: backgrounds.map(({ name, color }) => ({
      name,
      written: color,
      color: parseColor(color, `dev.backgrounds.${name}`),
    })),
    modes: resolved.modes,
    modeParents: resolved.modeDetails.map((mode) => mode.extends ?? null),
    warnings: resolved.warnings,
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
      domain: role.domain,
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

function numberRangesOf(algorithm: string): Record<string, { min: number; max: number }> {
  const params = algorithmFor(algorithm)?.params ?? {};
  return Object.fromEntries(
    Object.entries(params).flatMap(([name, kind]) =>
      kind.kind === "number" && kind.min != null && kind.max != null ? [[name, { min: kind.min, max: kind.max }]] : [],
    ),
  );
}
