import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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

/** The CSS a definition emits when nothing names one: beside it, with its name. */
export function generatedCssBeside(definition: string): string {
  const stem = basename(definition).replace(/\.dtg\.yaml$/, "");
  return join(dirname(definition), `${stem}.generated.css`);
}

function starterConfig(definition: string): string {
  const css = generatedCssBeside(definition);
  return `# dtg project config. Paths are relative to this file.
definitions: ${definition}
outputs:
  css: ${css}
`;
}

const STARTER_DEFINITION = `# Your color system, as decisions. Raw colors live only in \`palette\` and
# \`systems\`; roles point at them. Run \`npx dtg dev\` to browse and edit it.
dtg: 1

modes:
  light: { scheme: light }
  dark: { scheme: dark }

palette:
  hues:
    emit: false
    accent: "#0066ff"

systems:
  # A neutral ramp per mode: ink tinted over a base. light(3) is 3% ink.
  light:
    algorithm: tint
    params: { base: "#ffffff", tint: "#000000" }
  dark:
    algorithm: tint
    params: { base: "#111111", tint: "#ffffff" }
  # A chromatic scale: the hue at 500, running toward white and black at
  # the ends. accent(600) is the 600 stop.
  accent:
    algorithm: scale
    params: { base: hues.accent, toward: ["#ffffff", "#111111"] }
    emit: [100, 200, 400, 600, 800]

roles:
  surface:
    canvas: [light(3), dark(0)]
    card: [light(1), dark(1)]
  label:
    primary: [dark(0), light(0)]
    secondary: [dark(30), light(40)]
  separator:
    primary: [light(15), dark(16)]
  theme:
    primary: [accent(600), accent(400)]
`;

/** Where `dtg init` offers to put the definition: under src/ when a project has one. */
export function defaultDefinitionPath(): string {
  return existsSync("src") ? "src/colors.dtg.yaml" : "colors.dtg.yaml";
}

const BLANK_DEFINITION = `# Your color system, as decisions. Raw colors live only in \`palette\` and
# \`systems\`; roles point at them. Run \`npx dtg dev\` to browse and edit it.
dtg: 1

modes: [light, dark]

# palette:                       # the colors you have, as they are
#   gray: { 50: "#f7f8f9", 900: "#1d2125" }
# core:                          # names that point at them, one ref per mode
#   surface:
#     canvas: [gray.50, gray.900]
`;

/** What `dtg init` can write as the definition. The examples ship in dist/examples. */
export const STARTS = {
  starter: "a starter: two neutral ramps and an accent",
  blank: "a blank: the modes, and nothing else",
  tailwind: "Tailwind v4's palette, as curve systems",
  material: "Material 3's scheme, as tone systems",
} as const;
export type Start = keyof typeof STARTS;

function startingDefinition(from: Start): string {
  if (from === "starter") return STARTER_DEFINITION;
  if (from === "blank") return BLANK_DEFINITION;
  return readFileSync(new URL(`./examples/${from}.dtg.yaml`, import.meta.url), "utf8");
}

/**
 * Writes a starter dtg.config.yaml naming `definition`, and the definition
 * itself (the starter, a blank, or one of the examples), into the current folder.
 * Never replaces a config that is there; a definition that is there is kept
 * and the config points at it.
 */
export function writeStarter(
  definition: string,
  from: Start = "starter",
): { definitionWritten: boolean } {
  try {
    writeFileSync("dtg.config.yaml", starterConfig(definition), { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    throw new Error("dtg.config.yaml is already here — edit it, or remove it first");
  }
  mkdirSync(dirname(definition), { recursive: true });
  try {
    writeFileSync(definition, startingDefinition(from), { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    return { definitionWritten: false };
  }
  return { definitionWritten: true };
}

/**
 * Where the definition is has no default: `dtg.config.yaml` or a flag says. An
 * unnamed CSS output lands beside the definition.
 * Precedence: CLI flags > dtg.config.yaml > defaults.
 */
export function loadConfig(flags: {
  definition?: string;
  css?: string;
  cssFormat?: string;
  cssModes?: string;
  scss?: string;
  dtcg?: string;
  dtcgColorSpace?: string;
}): DtgConfig {
  let fileConfig: Record<string, unknown> = {};
  if (existsSync("dtg.config.yaml")) {
    fileConfig = (parse(readFileSync("dtg.config.yaml", "utf8")) ?? {}) as Record<
      string,
      unknown
    >;
  }
  const outputs = (fileConfig.outputs ?? {}) as Record<string, unknown>;
  if (outputs.figma != null) {
    throw new Error(
      "dtg.config.yaml outputs.figma: the bespoke Figma payload was removed — use `dtcg` instead, which carries the same collections, modes, values and aliases plus stable identities",
    );
  }
  const css = parseCssOutput(outputs.css);
  const dtcg = parseDtcgOutput(outputs.dtcg);

  for (const key of Object.keys(outputs)) {
    if (!["css", "scss", "dtcg"].includes(key)) {
      throw new Error(
        `dtg.config.yaml outputs: unknown output "${key}" (known: css, scss, dtcg)`,
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
      ? (flags.css ?? css.path ?? generatedCssBeside(definition))
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
      assertColorSpace(fileConfig.gamut, "dtg.config.yaml gamut") ??
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
      "dtg.config.yaml outputs.css: expected a path or { path, format }",
    );
  }
  const block = value as Record<string, unknown>;
  for (const key of Object.keys(block)) {
    if (key !== "path" && key !== "format" && key !== "modes") {
      throw new Error(
        `dtg.config.yaml outputs.css: unknown key "${key}" (known: path, format, modes)`,
      );
    }
  }
  return {
    path: block.path as string | undefined,
    format: assertCssFormat(block.format, "dtg.config.yaml outputs.css.format"),
    modes: assertModeRendering(block.modes, "dtg.config.yaml outputs.css.modes"),
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
      "dtg.config.yaml outputs.dtcg: expected a path or { path, colorSpace }",
    );
  }
  const block = value as Record<string, unknown>;
  for (const key of Object.keys(block)) {
    if (key !== "path" && key !== "colorSpace") {
      throw new Error(
        `dtg.config.yaml outputs.dtcg: unknown key "${key}" (known: path, colorSpace)`,
      );
    }
  }
  return {
    path: block.path as string | undefined,
    colorSpace: assertColorSpace(
      block.colorSpace,
      "dtg.config.yaml outputs.dtcg.colorSpace",
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
      "no definition to read — run `dtg init` and point `definitions` in dtg.config.yaml at it, or pass --definition",
    );
  }
  if (target.endsWith(".yaml")) return target;
  if (!existsSync(target)) {
    throw new Error(`dtg.config.yaml definitions: no ${target}/ directory`);
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
