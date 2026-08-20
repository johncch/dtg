import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { CSS_FORMATS, type CssFormat } from "./emit.js";

export type DtgConfig = {
  /** The single resolved definition file. */
  definition: string;
  cssOut: string;
  cssFormat: CssFormat;
  /** Only emitted when configured. */
  dtcgOut?: string;
};

const DEFAULT_DIR = "design-tokens";

/**
 * Convention over configuration: with no dtg.yaml and no flags, definitions
 * are discovered in design-tokens/*.dtg.yaml and outputs land beside them.
 * Precedence: CLI flags > dtg.yaml > defaults.
 */
export function loadConfig(flags: {
  definition?: string;
  css?: string;
  cssFormat?: string;
  dtcg?: string;
}): DtgConfig {
  let fileConfig: Record<string, unknown> = {};
  if (existsSync("dtg.yaml")) {
    fileConfig = (parse(readFileSync("dtg.yaml", "utf8")) ?? {}) as Record<
      string,
      unknown
    >;
  }
  const outputs = (fileConfig.outputs ?? {}) as Record<string, unknown>;
  if (outputs.figma != null) {
    throw new Error(
      "dtg.yaml outputs.figma: the bespoke Figma payload was removed — use `dtcg` instead, which carries the same collections, modes, values and aliases plus stable identities",
    );
  }
  const css = parseCssOutput(outputs.css);

  return {
    definition:
      flags.definition ??
      discoverDefinition(fileConfig.definitions as string | undefined),
    cssOut: flags.css ?? css.path ?? join(DEFAULT_DIR, "tokens.generated.css"),
    cssFormat:
      assertCssFormat(flags.cssFormat, "--css-format") ?? css.format ?? "plain",
    dtcgOut: flags.dtcg ?? (outputs.dtcg as string | undefined),
  };
}

/** `css: <path>` or `css: { path, format }`. */
function parseCssOutput(value: unknown): {
  path?: string;
  format?: CssFormat;
} {
  if (value == null) return {};
  if (typeof value === "string") return { path: value };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "dtg.yaml outputs.css: expected a path or { path, format }",
    );
  }
  const block = value as Record<string, unknown>;
  for (const key of Object.keys(block)) {
    if (key !== "path" && key !== "format") {
      throw new Error(
        `dtg.yaml outputs.css: unknown key "${key}" (known: path, format)`,
      );
    }
  }
  return {
    path: block.path as string | undefined,
    format: assertCssFormat(block.format, "dtg.yaml outputs.css.format"),
  };
}

function assertCssFormat(
  value: unknown,
  context: string,
): CssFormat | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && CSS_FORMATS.includes(value as CssFormat)) {
    return value as CssFormat;
  }
  throw new Error(
    `${context}: expected one of ${CSS_FORMATS.join(", ")}, got ${JSON.stringify(value)}`,
  );
}

function discoverDefinition(configured: string | undefined): string {
  const target = configured ?? DEFAULT_DIR;
  if (target.endsWith(".yaml")) return target;
  if (!existsSync(target)) {
    throw new Error(
      `no ${target}/ directory found — create ${target}/<name>.dtg.yaml, add a dtg.yaml config, or pass --definition`,
    );
  }
  const files = readdirSync(target).filter((f) => f.endsWith(".dtg.yaml"));
  if (files.length === 0) {
    throw new Error(`no *.dtg.yaml files in ${target}/`);
  }
  if (files.length > 1) {
    throw new Error(
      `multiple definition files in ${target}/ (${files.join(", ")}) — multi-file definitions aren't supported yet; pass --definition`,
    );
  }
  return join(target, files[0]);
}
