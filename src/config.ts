import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import {
  CSS_FORMATS,
  DTCG_COLOR_SPACES,
  MODE_RENDERINGS,
  type CssFormat,
  type ModeRendering,
} from "./emit.js";
import type { Gamut } from "./color-math.js";

export type DtgConfig = {
  /** The single resolved definition file. */
  definition: string;
  /**
   * `outputs` is a set, so naming any entry replaces the default set rather
   * than adding to it — the convention lists follow (tsconfig `include`,
   * eslint `extends`), not the one per-option configs follow. Name nothing
   * and you get CSS; name scss and you get scss alone.
   */
  cssOut?: string;
  cssFormat: CssFormat;
  /** How CSS renders the mode axis: nested selectors, or folded into names. */
  cssModes: ModeRendering;
  /** Only emitted when configured. Sass variables are always flat. */
  scssOut?: string;
  /** Only emitted when configured. */
  dtcgOut?: string;
  /**
   * The color space every DTCG value is written in. Figma holds one profile
   * per document, so this has to match the file it is being synced into.
   */
  dtcgColorSpace: Gamut;
  /**
   * The widest colors the project means to author. A ceiling, not a clamp:
   * the picker stops at it and a color above it warns, but nothing is altered.
   */
  gamut: Gamut;
};

const PLACEHOLDER_CONFIG = `# dtg project config. Paths are relative to this file.
definitions: colors.dtg.yaml
outputs:
  css: colors.generated.css
`;

/** Writes a placeholder dtg.yaml into the current folder. Never replaces one that is there. */
export function writePlaceholderConfig(): void {
  try {
    writeFileSync("dtg.yaml", PLACEHOLDER_CONFIG, { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    throw new Error("dtg.yaml is already here — edit it, or remove it first");
  }
}

/**
 * Where the definition is has no default: `dtg.yaml` or a flag says. An
 * unnamed CSS output lands beside the definition.
 * Precedence: CLI flags > dtg.yaml > defaults.
 */
export function loadConfig(flags: {
  definition?: string;
  css?: string;
  cssFormat?: string;
  cssModes?: string;
  scss?: string;
  dtcg?: string;
  dtcgColorSpace?: string;
  gamut?: string;
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
  const dtcg = parseDtcgOutput(outputs.dtcg);

  for (const key of Object.keys(outputs)) {
    if (!["css", "scss", "dtcg"].includes(key)) {
      throw new Error(
        `dtg.yaml outputs: unknown output "${key}" (known: css, scss, dtcg)`,
      );
    }
  }
  // A flag names an output too, so `--scss x` alone emits scss alone.
  const requested = new Set(
    [
      outputs.css != null || flags.css != null ? "css" : null,
      outputs.scss != null || flags.scss != null ? "scss" : null,
      outputs.dtcg != null || flags.dtcg != null ? "dtcg" : null,
    ].filter((x): x is string => x != null),
  );
  if (requested.size === 0) requested.add("css");

  const definition =
    flags.definition ?? definitionIn(fileConfig.definitions as string | undefined);

  return {
    definition,
    cssOut: requested.has("css")
      ? (flags.css ?? css.path ?? join(dirname(definition), "tokens.generated.css"))
      : undefined,
    cssFormat:
      assertCssFormat(flags.cssFormat, "--css-format") ?? css.format ?? "plain",
    cssModes:
      assertModeRendering(flags.cssModes, "--css-modes") ??
      css.modes ??
      "nested",
    scssOut: flags.scss ?? (outputs.scss as string | undefined),
    dtcgOut: flags.dtcg ?? dtcg.path,
    dtcgColorSpace:
      assertColorSpace(flags.dtcgColorSpace, "--dtcg-color-space") ??
      dtcg.colorSpace ??
      "srgb",
    gamut:
      assertColorSpace(flags.gamut, "--gamut") ??
      assertColorSpace(fileConfig.gamut, "dtg.yaml gamut") ??
      "display-p3",
  };
}

/** `css: <path>` or `css: { path, format }`. */
function parseCssOutput(value: unknown): {
  path?: string;
  format?: CssFormat;
  modes?: ModeRendering;
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
    if (key !== "path" && key !== "format" && key !== "modes") {
      throw new Error(
        `dtg.yaml outputs.css: unknown key "${key}" (known: path, format, modes)`,
      );
    }
  }
  return {
    path: block.path as string | undefined,
    format: assertCssFormat(block.format, "dtg.yaml outputs.css.format"),
    modes: assertModeRendering(block.modes, "dtg.yaml outputs.css.modes"),
  };
}

function assertModeRendering(
  value: unknown,
  context: string,
): ModeRendering | undefined {
  if (value == null) return undefined;
  if (
    typeof value === "string" &&
    MODE_RENDERINGS.includes(value as ModeRendering)
  ) {
    return value as ModeRendering;
  }
  throw new Error(
    `${context}: expected one of ${MODE_RENDERINGS.join(", ")}, got ${JSON.stringify(value)}`,
  );
}

/** `dtcg: <path>` or `dtcg: { path, colorSpace }`. */
function parseDtcgOutput(value: unknown): {
  path?: string;
  colorSpace?: Gamut;
} {
  if (value == null) return {};
  if (typeof value === "string") return { path: value };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "dtg.yaml outputs.dtcg: expected a path or { path, colorSpace }",
    );
  }
  const block = value as Record<string, unknown>;
  for (const key of Object.keys(block)) {
    if (key !== "path" && key !== "colorSpace") {
      throw new Error(
        `dtg.yaml outputs.dtcg: unknown key "${key}" (known: path, colorSpace)`,
      );
    }
  }
  return {
    path: block.path as string | undefined,
    colorSpace: assertColorSpace(
      block.colorSpace,
      "dtg.yaml outputs.dtcg.colorSpace",
    ),
  };
}

function assertColorSpace(value: unknown, context: string): Gamut | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && DTCG_COLOR_SPACES.includes(value as Gamut)) {
    return value as Gamut;
  }
  throw new Error(
    `${context}: expected one of ${DTCG_COLOR_SPACES.join(", ")}, got ${JSON.stringify(value)}`,
  );
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

/** The definition file a `definitions` entry names: itself, or the one `*.dtg.yaml` in the directory it names. */
function definitionIn(target: string | undefined): string {
  if (target == null) {
    throw new Error(
      "no definition to read — run `dtg init` and point `definitions` in dtg.yaml at it, or pass --definition",
    );
  }
  if (target.endsWith(".yaml")) return target;
  if (!existsSync(target)) {
    throw new Error(`dtg.yaml definitions: no ${target}/ directory`);
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
