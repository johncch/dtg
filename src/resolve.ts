import { parse } from "yaml";
import {
  assertNameFragment,
  defaultPublicStep,
  defaultStepOrder,
  type AlgorithmImpl,
} from "./contract.js";
import { assertHex, hexToRgb } from "./color-math.js";
import { compose } from "./algorithms/compose.js";
import { inkRamp } from "./algorithms/ink-ramp.js";
import { oklchScale } from "./algorithms/oklch-scale.js";
import { overlay } from "./algorithms/overlay.js";

const builtinAlgorithms: Record<string, AlgorithmImpl> = {
  compose,
  "ink-ramp": inkRamp,
  "oklch-scale": oklchScale,
  overlay: overlay,
};

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

/** A public-name override: one name for all targets, or per-target ("css", "figma"). */
export type AliasValue = string | Record<string, string>;

/** The algorithm registry, for callers that need to re-run one directly. */
export function algorithmFor(
  name: string,
  extra?: Record<string, AlgorithmImpl>,
): AlgorithmImpl | undefined {
  return { ...builtinAlgorithms, ...extra }[name];
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

function compareSteps(
  algo: AlgorithmImpl,
  params: Record<string, unknown>,
  a: ResolvedStep,
  b: ResolvedStep,
): number {
  const ka = algo.stepOrder?.(params, a.selector) ?? defaultStepOrder(a.selector);
  const kb = algo.stepOrder?.(params, b.selector) ?? defaultStepOrder(b.selector);
  if (
    typeof ka === "number" &&
    typeof kb === "number" &&
    Number.isFinite(ka) &&
    Number.isFinite(kb)
  ) {
    if (ka !== kb) return ka - kb;
  } else if (String(ka) !== String(kb)) {
    return String(ka) < String(kb) ? -1 : 1;
  }
  return a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0;
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
          : `${target.system}/${target.selector}`;
      const uses = lineage.get(key) ?? [];
      uses.push({
        domain: role.domain,
        role: role.role,
        mode: resolved.modes[i] ?? String(i),
        translucent: !entry.opaque,
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
  css: string;
  opaque: boolean;
  overridden: boolean;
  /** What the algorithm produced, present only when an override won. */
  generatedCss?: string;
};

export type ResolvedSystem = {
  /** Internal dotted path — the stable identity refs point at. */
  system: string;
  segments: PathSegment[];
  alias?: AliasValue;
  algorithm: string;
  algorithmDescription: string;
  params: Record<string, unknown>;
  steps: ResolvedStep[];
};

/**
 * Prose notes for whoever replays this definition into a design tool. The
 * resolver never interprets one — the useful part is the intent, which is
 * exactly what a schema would strip out.
 */
export type ChangelogEntry = { date?: string; note: string };

/** One step of a systems-tree path, with the alias that renames it on emit. */
export type PathSegment = { name: string; alias?: AliasValue };

/** A declared constant. `path` is its internal identity; segments carry aliases. */
export type ResolvedStatic = {
  path: string;
  segments: PathSegment[];
  hex: string;
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
  css: string;
  opaque: boolean;
};

export type ResolvedRole = {
  section: string;
  domain: string;
  domainAlias?: AliasValue;
  domainOmit: boolean;
  role: string;
  alias?: AliasValue;
  omit: boolean;
  /** One entry per mode, in `modes` order. */
  perMode: ResolvedRef[];
};

export type ResolvedDefinition = {
  modes: string[];
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
  const segments: string[] = [];
  if (!role.domainOmit) {
    segments.push(aliasedName(role.domainAlias, target, role.domain));
  }
  if (!role.omit) segments.push(aliasedName(role.alias, target, role.role));
  return segments.join(separator);
}

export function resolveDefinition(
  yamlText: string,
  extraAlgorithms: Record<string, AlgorithmImpl> = {},
): ResolvedDefinition {
  const doc = parse(yamlText) as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];
  const algorithms = { ...builtinAlgorithms, ...extraAlgorithms };

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
  const modes = Array.isArray(doc.modes) ? doc.modes.map(String) : [];
  if (modes.length === 0) errors.push("`modes` must be a non-empty list");

  const defaults = (doc.defaults ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  for (const algoName of Object.keys(defaults)) {
    if (!algorithms[algoName]) {
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
    algo: AlgorithmImpl;
    algoName: string;
    params: Record<string, unknown>;
    overrides: Record<string, string>;
    alias?: AliasValue;
    declared: string[] | null;
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
            hex: assertHex(raw, `constant "${path}"`),
          });
        } catch (e) {
          errors.push((e as Error).message);
        }
        continue;
      }
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`"${path}": expected a hex color, a group, or a system`);
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
      const algo = algorithms[algoName];
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
      const params = {
        ...defaults[algoName],
        ...((paramsBlock ?? {}) as Record<string, unknown>),
      };
      let declared: string[] | null = null;
      try {
        declared = algo.declaredSelectors(params);
      } catch (e) {
        errors.push(`system "${path}": ${(e as Error).message}`);
        continue;
      }
      systems.set(path, {
        algo,
        algoName,
        params,
        overrides: (block.overrides ?? {}) as Record<string, string>,
        alias,
        declared,
        segments: named,
      });
    }
  }
  walkSystems(systemsBlock, []);

  const stepCache = new Map<string, ResolvedStep | undefined>();

  function resolveStep(
    systemName: string,
    selector: string,
    refContext: string,
  ): ResolvedStep | undefined {
    const key = `${systemName}/${selector}`;
    if (stepCache.has(key)) return stepCache.get(key);
    const sys = systems.get(systemName);
    let step: ResolvedStep | undefined;
    if (!sys) {
      errors.push(`${refContext}: unknown system "${systemName}"`);
    } else if (sys.declared && !sys.declared.includes(selector)) {
      errors.push(
        `${refContext}: "${systemName}" declares no stop "${selector}"`,
      );
    } else {
      try {
        const value = sys.algo.resolveStep(sys.params, selector);
        const override = sys.overrides[selector];
        const overrideCss =
          override != null
            ? assertHex(override, `override "${key}"`)
            : undefined;
        step = {
          selector,
          publicStep: assertNameFragment(
            sys.algo.publicStep?.(sys.params, selector) ??
              defaultPublicStep(selector),
            key,
          ),
          css: overrideCss ?? value.css,
          opaque: value.opaque,
          overridden: overrideCss != null,
          generatedCss: overrideCss != null ? value.css : undefined,
        };
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
    domain: string;
    domainAlias?: AliasValue;
    domainOmit: boolean;
    role: string;
    alias?: AliasValue;
    omit: boolean;
    refs: string[];
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

    for (const [domainName, domainRaw] of Object.entries(sectionBlock)) {
      if (domainName === "alias" || domainName === "omit") continue;
      if (
        domainRaw == null ||
        typeof domainRaw !== "object" ||
        Array.isArray(domainRaw)
      ) {
        errors.push(`${sectionName}.${domainName}: a domain is a map of roles`);
        continue;
      }
      const domainBlock = domainRaw as Record<string, unknown>;
      const domainAlias = parseAlias(
        domainBlock.alias,
        `domain "${sectionName}.${domainName}"`,
      );
      const domainOmit = domainBlock.omit === true;

      for (const [roleName, roleRaw] of Object.entries(domainBlock)) {
        if (roleName === "alias" || roleName === "omit") continue;
        const path = `${domainName}.${roleName}`;
        const context = `${sectionName}.${path}`;
        let refs: string[] | undefined;
        let alias: AliasValue | undefined;
        let omit = false;
        if (Array.isArray(roleRaw)) {
          refs = roleRaw.map(String);
        } else if (roleRaw != null && typeof roleRaw === "object") {
          const block = roleRaw as Record<string, unknown>;
          for (const key of Object.keys(block)) {
            if (!["refs", "alias", "omit"].includes(key)) {
              errors.push(`${context}: unknown role key "${key}"`);
            }
          }
          if (!Array.isArray(block.refs)) {
            errors.push(`${context}: expected a \`refs\` list`);
            continue;
          }
          refs = block.refs.map(String);
          alias = parseAlias(block.alias, context);
          omit = block.omit === true;
        } else {
          errors.push(
            `${context}: a role is a ref list or { refs, alias?, omit? }`,
          );
          continue;
        }
        if (omit && domainOmit) {
          errors.push(
            `${context}: domain and role are both omitted — nothing left to name`,
          );
        }
        if (roleIndex.has(path)) {
          errors.push(
            `role path "${path}" appears in more than one section — refs would be ambiguous`,
          );
          continue;
        }
        roleIndex.set(path, {
          section: sectionName,
          domain: domainName,
          domainAlias,
          domainOmit,
          role: roleName,
          alias,
          omit,
          refs,
        });
        roleOrder.push(path);
      }
    }
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
    if (modes.length > 0 && raw.refs.length !== modes.length) {
      errors.push(
        `${path}: expected ${modes.length} refs (one per mode), got ${raw.refs.length}${
          raw.refs.some((r) => /^transparent\(/.test(r) && !r.endsWith(")"))
            ? " — a comma inside a `[ ]` list separates items. transparent() takes a space: transparent(shade 70)."
            : ""
        }`,
      );
      roleCache.set(path, undefined);
      return undefined;
    }

    const perMode: ResolvedRef[] = [];
    for (let i = 0; i < raw.refs.length; i++) {
      const ref = raw.refs[i];
      const context = `${path}[${modes[i] ?? i}]`;
      const resolved = resolveRef(ref, i, context, [...stack, path]);
      if (resolved) perMode.push(resolved);
    }

    const complete = perMode.length === raw.refs.length;
    if (complete && new Set(perMode.map((entry) => entry.opaque)).size > 1) {
      warnings.push(
        `${path}: modes mix opaque and translucent values — probably a mistake`,
      );
    }
    const resolvedRole: ResolvedRole = {
      section: raw.section,
      domain: raw.domain,
      domainAlias: raw.domainAlias,
      domainOmit: raw.domainOmit,
      role: raw.role,
      alias: raw.alias,
      omit: raw.omit,
      perMode,
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
    const transparentMatch = ref.match(
      /^transparent\(\s*([^\s(),]+)(?:\s+([^\s(),]+))?\s*\)$/,
    );
    if (transparentMatch) {
      const inner = transparentMatch[1];
      const weight = transparentMatch[2];
      if (weight != null) {
        // transparent(<constant>, <opacity>): a declared color at an alpha,
        // never composited. The system/selector form takes its weight from
        // the selector instead, so the two spellings do not overlap.
        if (inner.includes("/")) {
          errors.push(
            `${context}: "${ref}" mixes forms — a system/selector ref already carries its weight`,
          );
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
        const [r, g, b] = hexToRgb(constant.hex);
        return {
          ref,
          target: { kind: "constant", name: inner, alpha },
          css: `rgba(${r}, ${g}, ${b}, ${alpha / 100})`,
          opaque: false,
        };
      }
      errors.push(
        `${context}: transparent() takes a constant and an opacity, as transparent(shade 70). For a system's uncomposited form, ask the algorithm — ink-ramp spells it "sky/3/ink".`,
      );
      return undefined;
    }
    if (ref.includes("/")) {
      const slash = ref.indexOf("/");
      const system = ref.slice(0, slash);
      const selector = ref.slice(slash + 1);
      const step = resolveStep(system, selector, context);
      if (!step) return undefined;
      return {
        ref,
        target: { kind: "step", system, selector },
        css: step.css,
        opaque: step.opaque,
      };
    }
    if (ref.includes(".") && roleIndex.has(ref)) {
      const targetRole = resolveRole(ref, stack);
      const entry = targetRole?.perMode[modeIndex];
      if (!entry) return undefined;
      const dot = ref.indexOf(".");
      return {
        ref,
        target: {
          kind: "role",
          domain: ref.slice(0, dot),
          role: ref.slice(dot + 1),
        },
        css: entry.css,
        opaque: entry.opaque,
      };
    }
    const constant = statics.find((s) => s.path === ref);
    if (constant) {
      return {
        ref,
        target: { kind: "constant", name: ref },
        css: constant.hex,
        opaque: true,
      };
    }
    if (/^transparent\(/.test(ref) && !ref.endsWith(")")) {
      errors.push(
        `${context}: "${ref}" was cut short — a comma inside a \`[ ]\` list separates items. Write the refs as a block list ("- transparent(x, 70)") or quote this one.`,
      );
      return undefined;
    }
    if (/^[0-9.]+\)$/.test(ref)) {
      errors.push(
        `${context}: "${ref}" is the tail of a transparent(...) ref split by a comma inside a \`[ ]\` list — use a block list or quote the ref.`,
      );
      return undefined;
    }
    errors.push(
      `${context}: unrecognized ref "${ref}" — expected system/selector, domain.role, a declared constant, or transparent(...)`,
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
    if (sys.declared) {
      steps = sys.declared
        .map((selector) => resolveStep(name, selector, `system "${name}"`))
        .filter((s): s is ResolvedStep => s != null);
    } else {
      steps = [...stepCache.entries()]
        .filter(([key, step]) => step != null && key.startsWith(`${name}/`))
        .map(([, step]) => step as ResolvedStep)
        .sort((a, b) => compareSteps(sys.algo, sys.params, a, b));
    }
    const emitted = new Set(steps.map((s) => s.selector));
    for (const selector of Object.keys(sys.overrides)) {
      if (!emitted.has(selector)) {
        warnings.push(
          `override "${name}/${selector}" pins a step nothing demands — it emits nothing`,
        );
      }
    }
    resolvedSystems.push({
      system: name,
      segments: sys.segments,
      alias: sys.alias,
      algorithm: sys.algoName,
      algorithmDescription: sys.algo.description,
      params: sys.params,
      steps,
    });
  }

  if (errors.length > 0) {
    throw new Error(`definition errors:\n- ${errors.join("\n- ")}`);
  }

  return {
    modes,
    changelog,
    systems: resolvedSystems,
    systemsAlias,
    statics,
    sections,
    roles,
    warnings,
  };
}
