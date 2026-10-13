import {
  convert,
  formatColor,
  isOpaque,
  needsMapping,
  rgbToHex,
  type Color,
  type Gamut,
  type Rgb,
} from "./color-math.js";
import {
  aliasedName,
  buildLineage,
  publicPath,
  publicRoleName,
  publicSystemName,
  type Lineage,
  type ResolvedDefinition,
  type ResolvedRef,
  type ResolvedRole,
  type ResolvedStep,
  type ResolvedSystem,
} from "./resolve.js";
import { formatRef } from "./selector.js";

/**
 * `plain` emits primitives into `:root`, usable by any stylesheet.
 * `tailwind` wraps them in `@theme` and adds the `@theme inline` utility
 * wiring — correct inside a Tailwind v4 build, and inert anywhere else,
 * since a browser discards an at-rule it does not know.
 */
export type CssFormat = "plain" | "tailwind";

export const CSS_FORMATS: CssFormat[] = ["plain", "tailwind"];

/**
 * How a format renders the mode axis. `nested` puts each mode in its own
 * structure — CSS selectors, DTCG's own mode map — and the consumer picks one
 * by being inside it. `flat` folds the mode into the name instead, so every
 * mode's value is present at once and the consumer picks one by naming it.
 *
 * Not every format can do both: Sass variables are compile-time and have no
 * structure to nest into, so scss is flat and only flat.
 */
export type ModeRendering = "nested" | "flat";

export const MODE_RENDERINGS: ModeRendering[] = ["nested", "flat"];

/**
 * The variable a role emits under, for one mode, in each rendering. A single
 * mode contributes nothing to the name — there is no axis to disambiguate —
 * so flat and nested coincide there.
 */
function roleVarName(
  role: ResolvedRole,
  mode: string,
  modes: ModeRendering,
  modeCount: number,
): string {
  const name = publicRoleName(role, "css", "-");
  return modes === "flat" && modeCount > 1 ? `${mode}-${name}` : name;
}

function cssVarName(role: ResolvedRole): string {
  return publicRoleName(role, "css", "-");
}

function parentModeIndex(
  resolved: ResolvedDefinition,
  modeIndex: number,
): number | undefined {
  const parent = resolved.modeDetails[modeIndex].extends;
  return parent === undefined ? undefined : resolved.modes.indexOf(parent);
}

function findRole(
  resolved: ResolvedDefinition,
  target: { domain: string; role: string },
): ResolvedRole | undefined {
  return resolved.roles.find(
    (r) => r.domain === target.domain && r.role === target.role,
  );
}

/**
 * True when a role's value in a mode is, by construction, its value in the
 * mode that one extends. Inheriting the ref is not enough: an inherited ref
 * to another role resolves again in this mode, so it only matches the parent
 * if the role it points at does too.
 */
function sameAsParent(
  resolved: ResolvedDefinition,
  role: ResolvedRole,
  modeIndex: number,
): boolean {
  if (!role.inherited[modeIndex]) return false;
  const target = role.perMode[modeIndex].target;
  if (target.kind !== "role") return true;
  const targetRole = findRole(resolved, target);
  return (
    targetRole !== undefined && sameAsParent(resolved, targetRole, modeIndex)
  );
}

/**
 * Whether a rendering writes nothing for this role in this mode. Nested
 * leaves out every inherited role, because the parent's declaration is
 * selected for this mode too and its `var()` resolves here. Flat has no
 * cascade, so it can only leave out a value the parent's variable already
 * holds.
 */
function leftOut(
  resolved: ResolvedDefinition,
  role: ResolvedRole,
  modeIndex: number,
  modes: ModeRendering,
): boolean {
  return modes === "flat"
    ? sameAsParent(resolved, role, modeIndex)
    : role.inherited[modeIndex];
}

/**
 * A nested mode's block is selected by the mode and by every mode that
 * extends it, so an element carrying only `.dark-hc` still gets everything
 * `.dark` declares. Blocks are written parent first; a child's own block
 * comes later at equal specificity and wins.
 */
function modeSelector(resolved: ResolvedDefinition, modeIndex: number): string {
  const descendants = resolved.modes.filter((_, candidate) => {
    let ancestor = parentModeIndex(resolved, candidate);
    while (ancestor !== undefined && ancestor !== modeIndex) {
      ancestor = parentModeIndex(resolved, ancestor);
    }
    return ancestor === modeIndex;
  });
  return [
    modeIndex === 0 ? ":root" : `.${resolved.modes[modeIndex]}`,
    ...descendants.map((mode) => `.${mode}`),
  ].join(", ");
}

/**
 * `inlined` is true when the value is the color itself rather than a
 * pointer at a primitive. Only an inlined value needs repeating in the
 * wide-gamut layer — a `var()` picks up whatever the primitive was
 * redefined to.
 */
function cssValueFor(
  resolved: ResolvedDefinition,
  entry: ResolvedRef,
  mode: string,
  modes: ModeRendering,
): { css: string; inlined: boolean } {
  const target = entry.target;
  if (target.kind === "step" && isOpaque(entry.color)) {
    const system = resolved.systems.find((s) => s.system === target.system);
    const step = system?.steps.find((s) => s.selector === target.selector);
    if (system && step) {
      return {
        css: `var(--color-${publicSystemName(system, "css")}-${step.publicStep})`,
        inlined: false,
      };
    }
  }
  if (target.kind === "constant" && isOpaque(entry.color)) {
    const constant = resolved.statics.find((c) => c.path === target.name);
    if (constant) {
      return {
        css: `var(--color-${publicPath(constant.segments, "css", "-")})`,
        inlined: false,
      };
    }
  }
  if (target.kind === "role") {
    const role = findRole(resolved, target);
    if (role) {
      let owner = resolved.modes.indexOf(mode);
      if (modes === "flat") {
        while (sameAsParent(resolved, role, owner)) {
          owner = parentModeIndex(resolved, owner)!;
        }
      }
      return {
        css: `var(--${roleVarName(role, resolved.modes[owner], modes, resolved.modes.length)})`,
        inlined: false,
      };
    }
  }
  // transparent() results and overlay steps have no primitive variable to
  // point at; they inline their computed value.
  return { css: formatColor(entry.color, "srgb"), inlined: true };
}

export function emitCss(
  resolved: ResolvedDefinition,
  format: CssFormat = "plain",
  modes: ModeRendering = "nested",
): string {
  const lines: string[] = [];
  lines.push(
    "/* Generated by dtg from the definition file — do not edit. */",
    "",
    format === "tailwind" ? "@theme {" : ":root {",
  );
  for (const system of resolved.systems) {
    const opaqueSteps = system.steps.filter((s) => isOpaque(s.color));
    if (opaqueSteps.length === 0) continue;
    const name = publicSystemName(system, "css");
    lines.push(`  /* ${system.system} (${system.algorithm}) */`);
    for (const step of opaqueSteps) {
      lines.push(`  --color-${name}-${step.publicStep}: ${formatColor(step.color, "srgb")};`);
    }
  }
  if (resolved.statics.length > 0) {
    lines.push("  /* statics */");
    for (const s of resolved.statics) {
      lines.push(`  --color-${publicPath(s.segments, "css", "-")}: ${formatColor(s.color, "srgb")};`);
    }
  }
  lines.push("}", "");

  if (modes === "flat") {
    lines.push(":root {");
    resolved.modes.forEach((mode, i) => {
      const decls = resolved.roles
        .filter((role) => !leftOut(resolved, role, i, modes))
        .map(
          (role) =>
            `  --${roleVarName(role, mode, modes, resolved.modes.length)}: ${cssValueFor(resolved, role.perMode[i], mode, modes).css};`,
        );
      if (decls.length === 0) return;
      // The per-mode header only earns its place when there is more than one.
      if (resolved.modes.length > 1) lines.push(`  /* ${mode} */`);
      lines.push(...decls);
    });
    lines.push("}", "");
  } else {
    resolved.modes.forEach((mode, i) => {
      const decls = resolved.roles
        .filter((role) => !leftOut(resolved, role, i, modes))
        .map(
          (role) =>
            `  --${cssVarName(role)}: ${cssValueFor(resolved, role.perMode[i], mode, modes).css};`,
        );
      // A mode that extends another is already inside its parent's block, so
      // a scheme it only inherited is not written again.
      const scheme = resolved.modeDetails[i].scheme;
      const parent = parentModeIndex(resolved, i);
      const parentScheme =
        parent === undefined ? undefined : resolved.modeDetails[parent].scheme;
      if (scheme !== undefined && scheme !== parentScheme) {
        decls.unshift(`  color-scheme: ${scheme};`);
      }
      if (decls.length === 0) return;
      lines.push(`${modeSelector(resolved, i)} {`, ...decls, "}", "");
    });
  }

  lines.push(...wideGamutLayer(resolved, modes));

  if (format === "tailwind") {
    lines.push(
      "/* Semantic tokens wired into Tailwind utilities */",
      "@theme inline {",
    );
    const wired =
      modes === "flat"
        ? resolved.roles.flatMap((role) =>
            resolved.modes.flatMap((mode, i) =>
              leftOut(resolved, role, i, modes)
                ? []
                : [roleVarName(role, mode, modes, resolved.modes.length)],
            ),
          )
        : resolved.roles.map((role) => cssVarName(role));
    for (const name of wired) {
      lines.push(`  --color-${name}: var(--${name});`);
    }
    lines.push("}");
  }
  while (lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

/**
 * Sass variables, resolved at compile time. Every value is a literal — there
 * is no `var()` to defer, so a role that points at a primitive is emitted as
 * the primitive's color rather than a reference to it.
 *
 * Flat only, and not by omission: a Sass variable has no structure to nest a
 * mode into, so the mode is part of the name. That is the same rendering
 * `emitCss` offers under `modes: flat`, which is why this is a format and not
 * a second structural answer.
 */
export function emitScss(resolved: ResolvedDefinition): string {
  const lines = ["// Generated by dtg from the definition file — do not edit."];
  for (const [i, mode] of resolved.modes.entries()) {
    lines.push("");
    if (resolved.modes.length > 1) lines.push(`// ${mode}`);
    let domain: string | null = null;
    for (const role of resolved.roles) {
      if (leftOut(resolved, role, i, "flat")) continue;
      if (role.domain !== domain) {
        domain = role.domain;
        lines.push(`// ${domain}`);
      }
      const name = roleVarName(role, mode, "flat", resolved.modes.length);
      lines.push(`$${name}: ${formatColor(role.perMode[i].color, "srgb")};`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Colors outside sRGB are written twice: mapped into sRGB above, for every
 * browser, then again here at full strength for displays that can show them.
 * The order matters — the fallback has to be the one a browser that cannot
 * parse `color()` keeps.
 *
 * Only values that actually leave sRGB are repeated. An in-gamut color
 * renders identically either way, so redefining it would be bytes for
 * nothing, and a definition authored entirely in sRGB emits no layer at all.
 */
function wideGamutLayer(
  resolved: ResolvedDefinition,
  modes: ModeRendering,
): string[] {
  const blocks: string[] = [];

  const primitives: string[] = [];
  for (const system of resolved.systems) {
    const name = publicSystemName(system, "css");
    for (const step of system.steps) {
      if (!isOpaque(step.color) || !needsMapping(step.color, "srgb")) continue;
      primitives.push(
        `    --color-${name}-${step.publicStep}: ${formatColor(step.color, "display-p3")};`,
      );
    }
  }
  for (const s of resolved.statics) {
    if (!needsMapping(s.color, "srgb")) continue;
    primitives.push(
      `    --color-${publicPath(s.segments, "css", "-")}: ${formatColor(s.color, "display-p3")};`,
    );
  }

  const roleBlocks: string[] = [];
  const flatDecls: string[] = [];
  resolved.modes.forEach((mode, i) => {
    const decls: string[] = [];
    for (const role of resolved.roles) {
      if (leftOut(resolved, role, i, modes)) continue;
      const entry = role.perMode[i];
      if (!cssValueFor(resolved, entry, mode, modes).inlined) continue;
      if (!needsMapping(entry.color, "srgb")) continue;
      decls.push(
        `    --${roleVarName(role, mode, modes, resolved.modes.length)}: ${formatColor(entry.color, "display-p3")};`,
      );
    }
    if (decls.length === 0) return;
    if (modes === "flat") {
      flatDecls.push(...decls);
      return;
    }
    if (roleBlocks.length > 0) roleBlocks.push("");
    roleBlocks.push(`  ${modeSelector(resolved, i)} {`, ...decls, "  }");
  });
  if (flatDecls.length > 0) roleBlocks.push("  :root {", ...flatDecls, "  }");

  if (primitives.length === 0 && roleBlocks.length === 0) return [];
  blocks.push("/* Wider than sRGB — shown at full strength where supported */");
  blocks.push("@supports (color: color(display-p3 1 1 1)) {");
  if (primitives.length > 0) {
    // Primitives and roles share :root, but stay separate blocks — the same
    // split the sRGB pass makes, and it keeps roles last so one can override
    // the primitive it was derived from.
    blocks.push("  :root {", ...primitives, "  }");
    if (roleBlocks.length > 0) blocks.push("");
  }
  blocks.push(...roleBlocks, "}", "");
  return blocks;
}

/**
 * DTCG, for a courier that replays the system into a design tool. Two
 * conventions carry the weight:
 *
 * `$description` is identity, not documentation. A role's is its internal
 * path, which `alias` and `omit` never touch. A demand-driven step's is the
 * roles that demand it, which survives renumbering the coordinate. The
 * description syncs into the tool's own description field, where tree
 * position is invisible — so the redundancy is the point.
 *
 * `$extensions` holds the recipe, which is exactly the volatile part.
 */
const DTCG_NS = "com.fifthrevision.dtg";

/** Places a value at a dotted path, creating groups along the way. */
function placeAt(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split(".");
  let node = root;
  for (const key of keys.slice(0, -1)) {
    const existing = node[key];
    if (existing == null) {
      node[key] = {};
    } else if (
      typeof existing !== "object" ||
      Array.isArray(existing) ||
      "$type" in (existing as Record<string, unknown>)
    ) {
      throw new Error(`DTCG path "${path}" collides at "${key}"`);
    }
    node = node[key] as Record<string, unknown>;
  }
  const leaf = keys[keys.length - 1];
  if (Object.hasOwn(node, leaf)) {
    throw new Error(`DTCG path "${path}" is emitted more than once`);
  }
  node[leaf] = value;
}

/** The two color profiles a Figma document can be in. */
export const DTCG_COLOR_SPACES: Gamut[] = ["srgb", "display-p3"];

/**
 * Colors the DTCG emit has to gamut-map to reach `colorSpace`, by token path.
 * Writing a P3 anchor into an sRGB export is lossy and silent otherwise — the
 * value still emits, just duller than it was authored.
 */
export function dtcgClipped(
  resolved: ResolvedDefinition,
  colorSpace: Gamut,
): string[] {
  const clipped: string[] = [];
  for (const system of resolved.systems) {
    for (const step of system.steps) {
      if (needsMapping(step.color, colorSpace)) {
        clipped.push(formatRef(system.system, step.selector));
      }
    }
  }
  for (const s of resolved.statics) {
    if (needsMapping(s.color, colorSpace)) clipped.push(s.path);
  }
  return clipped;
}

export function emitDtcg(
  resolved: ResolvedDefinition,
  colorSpace: Gamut = "srgb",
): unknown {
  const lineage = buildLineage(resolved);
  const meta: Record<string, unknown> = {
    modes: resolved.modes,
    colorSpace,
    // The file is read by an agent syncing it into Figma, so it carries its
    // own handling note. Figma stores an unadorned RGB triple and reads it in
    // the document's color profile, so `components` goes straight in while
    // `hex` — this color rendered into sRGB — is only right in an sRGB file.
    writingIntoFigma:
      `Set the Figma document color profile to ${colorSpace} first — it cannot be set through the plugin API, only by hand. Then write each $value's components as {r, g, b, a}, or its hex where an API takes only hex; both name the same color in that profile. Nothing here is converted on import, so a document in any other profile will render every one of these wrong.`,
  };
  if (resolved.changelog.length > 0) meta.changelog = resolved.changelog;

  const out: Record<string, unknown> = {
    $description: "Generated by dtg from the definition file — do not edit.",
    $extensions: { [DTCG_NS]: meta },
  };

  // Sections seeded up front so every one carries its collection name,
  // aliased or not, in a deterministic order.
  for (const section of resolved.sections) {
    if (section.name === "systems") {
      throw new Error(
        `section "systems" collides with the DTCG primitives group — alias the section`,
      );
    }
    out[section.name] = {
      $extensions: {
        [DTCG_NS]: {
          collection: aliasedName(section.alias, "figma", section.name),
        },
      },
    };
  }

  const systems: Record<string, unknown> = {
    $extensions: {
      [DTCG_NS]: {
        collection: aliasedName(resolved.systemsAlias, "figma", "systems"),
      },
    },
  };
  for (const system of resolved.systems) {
    const steps = system.steps.filter((s) => isOpaque(s.color));
    if (steps.length === 0) continue;
    const group: Record<string, unknown> = {};
    for (const step of steps) {
      const ext: Record<string, unknown> = {
        name: `${publicSystemName(system, "figma", "/")}/${step.publicStep}`,
        ref: formatRef(system.system, step.selector),
        algorithm: system.algorithm,
      };
      if (step.overridden) ext.generated = formatColor(step.generated!, "srgb");
      group[step.publicStep] = {
        $type: "color",
        $value: dtcgColor(step.color, colorSpace),
        $description: stepIdentity(lineage, system, step),
        $extensions: { [DTCG_NS]: ext },
      };
    }
    placeAt(systems, system.system, group);
  }
  if (resolved.statics.length > 0) {
    const group = (systems.static ??= {}) as Record<string, unknown>;
    for (const s of resolved.statics) {
      placeAt(group, s.path, {
        $type: "color",
        $value: dtcgColor(s.color, colorSpace),
        $description: `static.${s.path}`,
        $extensions: {
          [DTCG_NS]: { name: `static/${publicPath(s.segments, "figma", "/")}` },
        },
      });
    }
  }
  out.systems = systems;

  for (const role of resolved.roles) {
    const section = (out[role.section] ??= {}) as Record<string, unknown>;
    // Roles nest as deep as the definition nests them, so the group tree is
    // built from the path rather than assumed to be two levels.
    const rolePath = role.segments.map((seg) => seg.name).join(".");
    placeAt(section, rolePath, {
      $type: "color",
      $value: dtcgRef(resolved, role.perMode[0], colorSpace),
      $description: rolePath,
      $extensions: {
        [DTCG_NS]: {
          name: publicRoleName(role, "figma", "/"),
          modes: Object.fromEntries(
            resolved.modes.map((m, i) => [m, dtcgRef(resolved, role.perMode[i], colorSpace)]),
          ),
          refs: Object.fromEntries(
            resolved.modes.map((m, i) => [m, role.perMode[i].ref]),
          ),
          // Figma has no unset mode — it fills one with white — so every mode
          // carries a value. This is the silence the definition declared,
          // each mode against the one it extends, kept so a round trip can
          // tell "tracks its parent" from "happens to match".
          ...(role.inherited.some(Boolean)
            ? {
                inherits: Object.fromEntries(
                  resolved.modeDetails
                    .filter((_, i) => role.inherited[i])
                    .map((mode) => [mode.name, mode.extends]),
                ),
              }
            : {}),
        },
      },
    });
  }

  return out;
}

/**
 * A DTCG color value, shaped for the consumer that matters: `components` is
 * an RGB triple 0..1, which is exactly what Figma's plugin API takes, so a
 * courier writes it straight in with no conversion.
 *
 * Every color in one emit shares `colorSpace`, and it is always an RGB space
 * — never oklab or oklch, which Figma cannot store. Figma holds one color
 * profile per document and interprets every stored triple in it, so a value
 * tagged with a different space than the document would have to be converted
 * on the way in. Choosing per color by what fits would make that per token.
 *
 * `hex` byte-encodes those same components rather than rendering the color
 * into sRGB, because Figma's hex field is document-relative too — it shows the
 * stored triple, whatever profile reads it. Written this way the two fields
 * never disagree, and importers that read only hex (Figma's DTCG import is
 * one) land the same color as importers that read components. 6-digit per
 * the spec, so it cannot contradict `alpha`.
 */
type DtcgColor = {
  colorSpace: Gamut;
  components: [number, number, number];
  alpha?: number;
  hex: string;
};

function dtcgColor(color: Color, colorSpace: Gamut): DtcgColor {
  const { coords, alpha } = convert(color, colorSpace);
  // hex is derived from the rounded components, not the raw ones, so a
  // consumer that byte-encodes components itself lands on the same value. A
  // channel sitting exactly on a .5 boundary rounds one way from the full
  // float and the other from the published component.
  const components = coords.map((c) => Number(c.toFixed(6))) as Rgb;
  return {
    colorSpace,
    components,
    ...(alpha < 1 ? { alpha: Number(alpha.toFixed(6)) } : {}),
    hex: rgbToHex(components.map((c) => c * 255) as Rgb),
  };
}

function stepIdentity(
  lineage: Lineage,
  system: ResolvedSystem,
  step: ResolvedStep,
): string {
  const uses = lineage.get(formatRef(system.system, step.selector)) ?? [];
  if (uses.length === 0) return formatRef(system.system, step.selector);
  return uses
    .map((u) => `${u.domain}.${u.role}[${u.mode}]`)
    .join(", ");
}

function dtcgRef(
  resolved: ResolvedDefinition,
  entry: ResolvedRef,
  colorSpace: Gamut,
): string | DtcgColor {
  const target = entry.target;
  if (target.kind === "role") {
    const role = resolved.roles.find(
      (r) => r.domain === target.domain && r.role === target.role,
    );
    if (role) return `{${role.section}.${role.domain}.${role.role}}`;
  }
  if (target.kind === "constant" && isOpaque(entry.color)) {
    return `{systems.static.${target.name}}`;
  }
  if (target.kind === "step" && isOpaque(entry.color)) {
    const system = resolved.systems.find((s) => s.system === target.system);
    const step = system?.steps.find((s) => s.selector === target.selector);
    if (system && step) return `{systems.${system.system}.${step.publicStep}}`;
  }
  return dtcgColor(entry.color, colorSpace);
}
