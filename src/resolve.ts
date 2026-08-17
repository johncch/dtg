import { parse } from "yaml";
import type { AlgorithmImpl } from "./contract.js";
import { assertHex } from "./color-math.js";
import { inkRamp } from "./algorithms/ink-ramp.js";
import { oklchScale } from "./algorithms/oklch-scale.js";
import { overlay } from "./algorithms/overlay.js";

const builtinAlgorithms: Record<string, AlgorithmImpl> = {
  "ink-ramp": inkRamp,
  "oklch-scale": oklchScale,
  overlay: overlay,
};

// Top-level keys the tool owns; every other top-level key is a section.
const TOP_LEVEL_RESERVED = ["dtg", "modes", "defaults", "systems"];
// System keys addressed to the tool, not the algorithm.
const SYSTEM_RESERVED = ["algorithm", "alias", "overrides"];

/** A public-name override: one name for all targets, or per-target ("css", "figma"). */
export type AliasValue = string | Record<string, string>;

export function aliasedName(
  alias: AliasValue | undefined,
  target: string,
  fallback: string,
): string {
  if (alias == null) return fallback;
  if (typeof alias === "string") return alias;
  return alias[target] ?? fallback;
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
  system: string;
  alias?: AliasValue;
  algorithm: string;
  algorithmDescription: string;
  params: Record<string, unknown>;
  steps: ResolvedStep[];
};

export type ResolvedSection = {
  name: string;
  alias?: AliasValue;
};

export type RefTarget =
  | { kind: "step"; system: string; selector: string }
  | { kind: "transparent"; system: string; selector: string }
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
  systems: ResolvedSystem[];
  /** The systems block's own alias (its Figma collection name). */
  systemsAlias?: AliasValue;
  statics: { name: string; hex: string }[];
  sections: ResolvedSection[];
  roles: ResolvedRole[];
  warnings: string[];
};

export function publicSystemName(
  system: ResolvedSystem,
  target: string,
): string {
  return aliasedName(system.alias, target, system.system);
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
  };
  const systems = new Map<string, SystemEntry>();
  const statics: { name: string; hex: string }[] = [];
  const systemsBlock = (doc.systems ?? {}) as Record<string, unknown>;
  const systemsAlias = parseAlias(systemsBlock.alias, "systems block");

  for (const [name, raw] of Object.entries(systemsBlock)) {
    if (name === "alias") continue;
    if (typeof raw === "string") {
      try {
        statics.push({ name, hex: assertHex(raw, `system "${name}"`) });
      } catch (e) {
        errors.push((e as Error).message);
      }
      continue;
    }
    const block = raw as Record<string, unknown>;
    if (block.emits !== undefined) {
      errors.push(`system "${name}": \`emits\` was renamed — use \`alias\``);
      continue;
    }
    const algoName = String(block.algorithm ?? "");
    const algo = algorithms[algoName];
    if (!algo) {
      errors.push(`system "${name}": unknown algorithm "${algoName}"`);
      continue;
    }
    const params = { ...defaults[algoName] };
    for (const [key, value] of Object.entries(block)) {
      if (!SYSTEM_RESERVED.includes(key)) params[key] = value;
    }
    let declared: string[] | null = null;
    try {
      declared = algo.declaredSelectors(params);
    } catch (e) {
      errors.push(`system "${name}": ${(e as Error).message}`);
      continue;
    }
    systems.set(name, {
      algo,
      algoName,
      params,
      overrides: (block.overrides ?? {}) as Record<string, string>,
      alias: parseAlias(block.alias, `system "${name}"`),
      declared,
    });
  }

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
          publicStep: selector.replace(".", "_"),
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

  function resolveTransparent(
    systemName: string,
    selector: string,
    refContext: string,
  ): string | undefined {
    const sys = systems.get(systemName);
    if (!sys) {
      errors.push(`${refContext}: unknown system "${systemName}"`);
      return undefined;
    }
    if (!sys.algo.resolveTranslucent) {
      errors.push(
        `${refContext}: "${systemName}" has no unflattened form for transparent()`,
      );
      return undefined;
    }
    if (sys.declared && !sys.declared.includes(selector)) {
      errors.push(
        `${refContext}: "${systemName}" declares no stop "${selector}"`,
      );
      return undefined;
    }
    if (sys.overrides[selector] != null) {
      warnings.push(
        `transparent(${systemName}/${selector}) follows the algorithm's ink math; the step's override pins only the flattened form`,
      );
    }
    try {
      return sys.algo.resolveTranslucent(sys.params, selector);
    } catch (e) {
      errors.push(`${refContext}: ${(e as Error).message}`);
      return undefined;
    }
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
        `${path}: expected ${modes.length} refs (one per mode), got ${raw.refs.length}`,
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
    const transparentMatch = ref.match(/^transparent\(\s*([^\s()]+)\s*\)$/);
    if (transparentMatch) {
      const inner = transparentMatch[1];
      const slash = inner.indexOf("/");
      if (slash < 1) {
        errors.push(
          `${context}: transparent() takes a system/selector ref, got "${inner}"`,
        );
        return undefined;
      }
      const system = inner.slice(0, slash);
      const selector = inner.slice(slash + 1);
      const css = resolveTransparent(system, selector, context);
      if (css == null) return undefined;
      return {
        ref,
        target: { kind: "transparent", system, selector },
        css,
        opaque: false,
      };
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
    if (ref.includes(".")) {
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
    errors.push(`${context}: unrecognized ref "${ref}"`);
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
        .sort((a, b) => Number(a.selector) - Number(b.selector));
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
    systems: resolvedSystems,
    systemsAlias,
    statics,
    sections,
    roles,
    warnings,
  };
}
