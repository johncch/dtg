import { parse } from "yaml";
import {
  assertNameFragment,
  type Algorithm,
  type ColorParam,
  type Params,
  type SelectorShape,
} from "./contract.js";
import { parseParams } from "./params.js";
import {
  allSelectors,
  formatRef,
  orderOf,
  parseCall,
  parseSelector,
  publicStepOf,
} from "./selector.js";
import {
  assertHex,
  colorFromHex,
  needsMapping,
  parseColor,
  isOpaque,
  type Color,
  type Gamut,
} from "./color-math.js";
import { blend } from "./algorithms/blend.js";
import { tint } from "./algorithms/tint.js";
import { scale } from "./algorithms/scale.js";
import { overlay } from "./algorithms/overlay.js";

const builtinAlgorithms: Algorithm[] = [blend, tint, scale, overlay];

function registryOf(extra: Algorithm[]): Map<string, Algorithm> {
  return new Map(
    [...builtinAlgorithms, ...extra].map((algorithm) => [
      algorithm.name,
      algorithm,
    ]),
  );
}

// Top-level keys the tool owns; every other top-level key is a section.
const TOP_LEVEL_RESERVED = [
  "dtg",
  "modes",
  "defaults",
  "systems",
  "changelog",
];
// A system node's keys. Params live in their own block, so this list can
// grow without ever colliding with an algorithm's parameter names.
const SYSTEM_RESERVED = ["algorithm", "params", "alias", "overrides"];

const RENAMED_ALGORITHMS: Record<string, string> = {
  "ink-ramp": "tint",
  "oklch-scale": "scale",
};

const TRANSPARENT_USAGE = `transparent() takes a constant and an opacity, as transparent(shade 70). For a system's uncomposited form, ask the algorithm — tint spells it "sky(3 tint)".`;

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
  // Two spellings of one coordinate ("3" and "3.0") still need a fixed order.
  const [x, y] = [a.step.selector, b.step.selector];
  return x < y ? -1 : x > y ? 1 : 0;
}

export type Lineage = Map<
  string,
  { domain: string; role: string; mode: string; translucent: boolean }[]
>;

export function buildLineage(resolved: ResolvedDefinition): Lineage {
  const lineage: Lineage = new Map();
  for (const role of resolved.roles) {
    role.perMode.forEach((entry, i) => {
      const target = entry.target;
      if (target.kind === "role") return;
      const key =
        target.kind === "constant"
          ? target.name
          : formatRef(target.system, target.selector);
      const uses = lineage.get(key) ?? [];
      uses.push({
        domain: role.domain,
        role: role.role,
        mode: resolved.modes[i] ?? String(i),
        translucent: !isOpaque(entry.color),
      });
      lineage.set(key, uses);
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
export type ResolvedColorParam = ColorParam & { from: "system" | "defaults" };

export type ResolvedSystem = {
  /** Internal dotted path — the stable identity refs point at. */
  system: string;
  segments: PathSegment[];
  alias?: AliasValue;
  algorithm: string;
  algorithmDescription: string;
  params: Record<string, unknown>;
  colorParams: ResolvedColorParam[];
  /** What a ref into this system is made of. */
  selector: SelectorShape;
  steps: ResolvedStep[];
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
  /** Dropped from the emitted name; the path still uses it for identity. */
  omit?: boolean;
};

/** A declared constant. `path` is its internal identity; segments carry aliases. */
export type ResolvedStatic = {
  path: string;
  segments: PathSegment[];
  color: Color;
};

/** Joins a path for emitting, applying each segment's alias. */
export function publicPath(
  segments: PathSegment[],
  target: string,
  sep: string,
): string {
  return segments.map((s) => aliasedName(s.alias, target, s.name)).join(sep);
}

export type ResolvedSection = {
  name: string;
  alias?: AliasValue;
};

export type RefTarget =
  | { kind: "step"; system: string; selector: string }
  /** A declared constant; `alpha` present means it was taken through transparent(). */
  | { kind: "constant"; name: string; alpha?: number }
  | { kind: "role"; domain: string; role: string };

export type ResolvedRef = {
  ref: string;
  target: RefTarget;
  color: Color;
};

export type ResolvedRole = {
  section: string;
  /**
   * The full path, one entry per level. Roles nest as deep as the definition
   * nests them, the same as the systems tree — `light.ink.primary` is three
   * segments, `label.primary` is two.
   */
  segments: PathSegment[];
  /** Everything but the last segment, dotted. Derived; `segments` is the truth. */
  domain: string;
  /** The last segment. Derived. */
  role: string;
  omit: boolean;
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

export type ResolvedDefinition = {
  modes: string[];
  /** Index-parallel to `modes`. */
  modeDetails: ResolvedMode[];
  changelog: ChangelogEntry[];
  systems: ResolvedSystem[];
  /** The systems block's own alias (its Figma collection name). */
  systemsAlias?: AliasValue;
  statics: ResolvedStatic[];
  sections: ResolvedSection[];
  roles: ResolvedRole[];
  warnings: string[];
};

export function publicSystemName(
  system: ResolvedSystem,
  target: string,
  sep = "-",
): string {
  return publicPath(system.segments, target, sep);
}

/** The role's public path segments for a target, alias applied, omissions dropped. */
export function publicRoleName(
  role: ResolvedRole,
  target: string,
  separator: string,
): string {
  return role.segments
    .filter((seg) => !seg.omit)
    .map((seg) => aliasedName(seg.alias, target, seg.name))
    .join(separator);
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
): ResolvedDefinition {
  const doc = parse(yamlText) as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];
  const algorithms = registryOf(extraAlgorithms);

  const grammar = doc.dtg;
  if (grammar == null) {
    warnings.push("no `dtg:` grammar version field — assuming 1");
  } else if (Number(grammar) !== 1) {
    errors.push(
      `unsupported grammar version ${JSON.stringify(grammar)} — this tool understands \`dtg: 1\``,
    );
  }
  if (doc.emit !== undefined) {
    errors.push(
      "the `emit:` block was replaced by inline `alias`/`omit` keys on systems, sections, domains, and roles",
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
    colorParams: ColorParam[];
    /** Top-level param keys the system wrote itself; the rest came from `defaults`. */
    ownParams: Set<string>;
    selectorShape: SelectorShape;
    overrides: Record<string, string>;
    alias?: AliasValue;
    /** Every selector, when the algorithm emits all of them; null when it emits on demand. */
    emitsAll: string[] | null;
    segments: PathSegment[];
  };
  const systems = new Map<string, SystemEntry>();
  const statics: ResolvedStatic[] = [];
  const systemsBlock = (doc.systems ?? {}) as Record<string, unknown>;
  const systemsAlias = parseAlias(systemsBlock.alias, "systems block");

  // A string is a constant, an object with `algorithm` is a system, and any
  // other object is a group. Groups nest, so a path is the identity.
  function walkSystems(node: Record<string, unknown>, prefix: PathSegment[]) {
    for (const [key, raw] of Object.entries(node)) {
      if (key === "alias") continue;
      const segments = [...prefix, { name: key }];
      const path = segments.map((seg) => seg.name).join(".");
      if (typeof raw === "string") {
        try {
          statics.push({
            path,
            segments,
            color: parseColor(raw, `constant "${path}"`),
          });
        } catch (e) {
          errors.push((e as Error).message);
        }
        continue;
      }
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`"${path}": expected a color, a group, or a system`);
        continue;
      }
      const block = raw as Record<string, unknown>;
      if (block.emits !== undefined) {
        errors.push(`system "${path}": \`emits\` was renamed — use \`alias\``);
        continue;
      }
      const alias = parseAlias(block.alias, `"${path}"`);
      const named = [...prefix, { name: key, alias }];
      if (block.algorithm === undefined) {
        walkSystems(block, named);
        continue;
      }
      const algoName = String(block.algorithm);
      if (path === "transparent") {
        errors.push(
          `system "transparent": that name is taken by transparent(), the constant-at-an-opacity ref`,
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
      if (algoName === "compose") {
        errors.push(
          `system "${path}": \`compose\` was renamed to \`blend\` — its params are now \`base\`, \`toward\` and \`space\``,
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
      let parsed: ReturnType<typeof parseParams>;
      let selectorShape: SelectorShape;
      let emitsAll: string[] | null;
      try {
        parsed = parseParams(algo, writtenParams);
        selectorShape = algo.selector(parsed.values);
        emitsAll = algo.emit === "all" ? allSelectors(selectorShape) : null;
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
        selectorShape,
        overrides: (block.overrides ?? {}) as Record<string, string>,
        alias,
        emitsAll,
        segments: named,
      });
    }
  }
  walkSystems(systemsBlock, []);

  const stepCache = new Map<string, ResolvedStep | undefined>();
  const stepOrders = new Map<ResolvedStep, number[]>();

  function resolveStep(
    systemName: string,
    selector: string,
    refContext: string,
  ): ResolvedStep | undefined {
    const key = formatRef(systemName, selector);
    if (stepCache.has(key)) return stepCache.get(key);
    const sys = systems.get(systemName);
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
          overrideColor = colorFromHex(assertHex(override, `override "${key}"`));
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
        `section "${sectionName}" must be a map of domains (top-level keys other than ${TOP_LEVEL_RESERVED.join("/")} are sections)`,
      );
      continue;
    }
    const sectionBlock = sectionRaw as Record<string, unknown>;
    if (sectionBlock.omit !== undefined) {
      errors.push(
        `section "${sectionName}": \`omit\` is not supported on sections`,
      );
    }
    sections.push({
      name: sectionName,
      alias: parseAlias(sectionBlock.alias, `section "${sectionName}"`),
    });

    // Roles nest as deep as the definition nests them. A node is a role when
    // it is a color, a ref list, or a block naming `refs` — the same
    // reserved-key test the systems tree uses to tell a system from a group.
    const walkRoles = (
      node: Record<string, unknown>,
      trail: PathSegment[],
    ): void => {
      for (const [name, raw] of Object.entries(node)) {
        if (name === "alias" || name === "omit") continue;
        const segments = [...trail, { name }];
        const path = segments.map((seg) => seg.name).join(".");
        const context = `${sectionName}.${path}`;

        let refs: (string | null)[] | undefined;
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
          segments[segments.length - 1] = {
            name,
            alias: parseAlias(block.alias, context),
            omit: block.omit === true,
          };
          if (!("refs" in block)) {
            walkRoles(block, segments);
            continue;
          }
          if (!Array.isArray(block.refs)) {
            errors.push(`${context}: expected a \`refs\` list`);
            continue;
          }
          refs = block.refs.map((r) => (r == null ? null : String(r)));
        } else {
          errors.push(
            modeless
              ? `${context}: a role is a color, a ref list, { refs, alias?, omit? }, or a group of roles`
              : `${context}: a role is a ref list, { refs, alias?, omit? }, or a group of roles`,
          );
          continue;
        }

        if (segments.every((seg) => seg.omit)) {
          errors.push(
            `${context}: every segment is omitted — nothing left to name`,
          );
        }
        if (roleIndex.has(path)) {
          errors.push(
            `role path "${path}" appears in more than one section — refs would be ambiguous`,
          );
          continue;
        }
        roleIndex.set(path, { section: sectionName, segments, refs });
        roleOrder.push(path);
      }
    };
    walkRoles(sectionBlock, []);
  }

  for (const constant of statics) {
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
    if (complete && new Set(perMode.map((entry) => isOpaque(entry.color))).size > 1) {
      warnings.push(
        `${path}: modes mix opaque and translucent values — probably a mistake`,
      );
    }
    const resolvedRole: ResolvedRole = {
      section: raw.section,
      segments: raw.segments,
      // Derived from segments, for callers that want "the last bit" and
      // "everything above it" — the dev server and the lineage index.
      domain: raw.segments.slice(0, -1).map((seg) => seg.name).join("."),
      role: raw.segments[raw.segments.length - 1].name,
      omit: raw.segments[raw.segments.length - 1].omit === true,
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
  ): ResolvedRef | undefined {
    if (ref.startsWith("#")) {
      errors.push(
        `${context}: raw hex is not allowed outside \`systems\` — point at a system or derive`,
      );
      return undefined;
    }
    const call = parseCall(ref);
    if (call && call.selector.includes(",")) {
      errors.push(
        `${context}: "${ref}" separates with a comma — write spaces, as ${ref.replace(/\s*,\s*/g, " ")}`,
      );
      return undefined;
    }
    if (call?.name === "transparent") {
      // transparent(<constant> <opacity>): a declared color at an alpha,
      // never composited. A system takes its weight from its own selector
      // instead, so the two do not overlap.
      const [inner, weight, ...rest] = call.selector.split(" ");
      if (weight == null || rest.length > 0) {
        errors.push(`${context}: ${TRANSPARENT_USAGE}`);
        return undefined;
      }
      const constant = statics.find((c) => c.path === inner);
      if (!constant) {
        errors.push(
          `${context}: unknown constant "${inner}" (declared: ${statics.map((c) => c.path).join(", ") || "none"})`,
        );
        return undefined;
      }
      const alpha = Number(weight);
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 100) {
        errors.push(
          `${context}: transparent() opacity must be a number 0-100, got "${weight}"`,
        );
        return undefined;
      }
      return {
        ref,
        target: { kind: "constant", name: inner, alpha },
        color: { ...constant.color, alpha: alpha / 100 },
      };
    }
    if (call) {
      const step = resolveStep(call.name, call.selector, context);
      if (!step) return undefined;
      return {
        ref,
        target: { kind: "step", system: call.name, selector: call.selector },
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
    if (ref.includes(".") && roleIndex.has(ref)) {
      const targetRole = resolveRole(ref, stack);
      const entry = targetRole?.perMode[modeIndex];
      if (!entry) return undefined;
      const dot = ref.lastIndexOf(".");
      return {
        ref,
        target: {
          kind: "role",
          domain: ref.slice(0, dot),
          role: ref.slice(dot + 1),
        },
        color: entry.color,
      };
    }
    const constant = statics.find((s) => s.path === ref);
    if (constant) {
      return {
        ref,
        target: { kind: "constant", name: ref },
        color: constant.color,
      };
    }
    if (ref.includes("(") && !ref.endsWith(")")) {
      errors.push(
        `${context}: "${ref}" was cut short — a comma inside a \`[ ]\` list separates items. Separate with spaces, as transparent(paper 70).`,
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
      `${context}: unrecognized ref "${ref}" — expected system(selector), domain.role, a declared constant, or transparent(...)`,
    );
    return undefined;
  }

  const roles: ResolvedRole[] = [];
  for (const path of roleOrder) {
    const resolved = resolveRole(path, []);
    if (resolved) roles.push(resolved);
  }

  // ---- public-name uniqueness (aliases and omissions can collide) ----
  for (const target of ["css", "figma"]) {
    const seen = new Map<string, string>();
    for (const role of roles) {
      const scope =
        target === "figma"
          ? `${aliasedName(sections.find((s) => s.name === role.section)?.alias, target, role.section)}/`
          : "";
      const name =
        scope + publicRoleName(role, target, target === "css" ? "-" : "/");
      const path = `${role.domain}.${role.role}`;
      const prior = seen.get(name);
      if (prior) {
        errors.push(
          `${target} name collision: "${name}" is emitted by both ${prior} and ${path}`,
        );
      } else {
        seen.set(name, path);
      }
    }
  }

  const resolvedSystems: ResolvedSystem[] = [];
  for (const [name, sys] of systems) {
    let steps: ResolvedStep[];
    if (sys.emitsAll) {
      steps = sys.emitsAll
        .map((selector) => resolveStep(name, selector, `system "${name}"`))
        .filter((s): s is ResolvedStep => s != null);
    } else {
      steps = [...stepCache.entries()]
        .filter(([key, step]) => step != null && key.startsWith(`${name}(`))
        .map(([, step]) => step as ResolvedStep)
        .map((step) => ({ step, order: stepOrders.get(step) ?? [] }))
        .sort(compareSteps)
        .map((ordered) => ordered.step);
    }
    // An input outside the gamut the arithmetic runs in is clipped on the way
    // in, and the definition still reads as if it were wide. This asks the
    // algorithm what gamut it works in rather than inspecting the steps: a
    // system whose demanded steps are all pale tints still lost the anchor.
    const workingGamut = sys.algo.workingGamut?.(sys.params) ?? null;
    if (workingGamut) {
      const clipped = sys.colorParams.filter((param) =>
        needsMapping(param.color, workingGamut),
      );
      if (clipped.length > 0) {
        warnings.push(
          `system "${name}" is given ${clipped.length} color${clipped.length === 1 ? "" : "s"} outside ${workingGamut}, but its transform runs in ${workingGamut} — the extra gamut is discarded on the way in. Every space has a display-p3 counterpart that keeps the same interpolation; switch to it rather than changing the interpolation itself.`,
        );
      }
    }

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
      params: sys.writtenParams,
      colorParams,
      selector: sys.selectorShape,
      steps,
    });
  }

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
    sections,
    roles,
    warnings,
  };
}
