import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export type DtgConfig = {
  /** The single resolved definition file. */
  definition: string;
  cssOut: string;
  figmaOut: string;
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
  figma?: string;
}): DtgConfig {
  let fileConfig: Record<string, unknown> = {};
  if (existsSync("dtg.yaml")) {
    fileConfig = (parse(readFileSync("dtg.yaml", "utf8")) ?? {}) as Record<
      string,
      unknown
    >;
  }
  const outputs = (fileConfig.outputs ?? {}) as Record<string, string>;

  return {
    definition:
      flags.definition ??
      discoverDefinition(fileConfig.definitions as string | undefined),
    cssOut:
      flags.css ?? outputs.css ?? join(DEFAULT_DIR, "tokens.generated.css"),
    figmaOut: flags.figma ?? outputs.figma ?? join(DEFAULT_DIR, "figma.json"),
  };
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
