import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse } from "yaml";
import {
  DTCG_COLOR_SPACES,
  MODE_RENDERINGS,
  type HostCss,
  type ModeRendering,
} from "./engine/emit.js";
import type { Gamut } from "./engine/color-math.js";

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
  /** How CSS renders the mode axis: nested selectors, or folded into names. */
  cssModes: ModeRendering;
  /** CSS for a Tailwind v4 build: primitives in its theme namespaces, roles wired into utilities. */
  tailwindOut?: string;
  tailwindModes: ModeRendering;
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

export function hostCss(config: DtgConfig): HostCss {
  return config.tailwindOut != null
    ? { names: "tailwind", modes: config.tailwindModes }
    : { names: "css", modes: config.cssModes };
}

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

/** Where `dtg init` offers to put the definition: under src/ when a project has one. */
export function defaultDefinitionPath(): string {
  return existsSync("src") ? "src/colors.dtg.yaml" : "colors.dtg.yaml";
}

const BLANK_DEFINITION = `# Your color system, as decisions. Raw colors live only in \`palette\` and
# \`systems\`; roles point at them. Run \`npx dtg edit\` to open it in the editor.
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
  starter: "a starter: five hues, scales and roles for light and dark",
  blank: "a blank: the modes, and nothing else",
  tailwind: "Tailwind v4's palette, as curve systems",
  material: "Material 3's scheme, as tone systems",
} as const;
export type Start = keyof typeof STARTS;

function startingDefinition(from: Start): string {
  if (from === "blank") return BLANK_DEFINITION;
  const example = from === "starter" ? "showcase" : from;
  return readFileSync(new URL(`./examples/${example}.dtg.yaml`, import.meta.url), "utf8");
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
  tailwind?: string;
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
  if (flags.cssFormat != null) {
    throw new Error("--css-format was removed — `--tailwind <path>` writes the Tailwind file, and `--css` plain CSS");
  }
  const css = parseCssOutput(outputs.css, "css");
  const tailwind = parseCssOutput(outputs.tailwind, "tailwind");
  const dtcg = parseDtcgOutput(outputs.dtcg);

  for (const key of Object.keys(outputs)) {
    if (!["css", "tailwind", "scss", "dtcg"].includes(key)) {
      throw new Error(
        `dtg.config.yaml outputs: unknown output "${key}" (known: css, tailwind, scss, dtcg)`,
      );
    }
  }
  // A flag names an output too, so `--scss x` alone emits scss alone.
  const requested = new Set(
    [
      outputs.css != null || flags.css != null ? "css" : null,
      outputs.tailwind != null || flags.tailwind != null ? "tailwind" : null,
      outputs.scss != null || flags.scss != null ? "scss" : null,
      outputs.dtcg != null || flags.dtcg != null ? "dtcg" : null,
    ].filter((x): x is string => x != null),
  );
  if (requested.size === 0) requested.add("css");

  const definition =
    flags.definition ?? definitionIn(fileConfig.definitions as string | undefined);

  const modesFlag = assertModeRendering(flags.cssModes, "--css-modes");
  const cssOut = requested.has("css")
    ? (flags.css ?? css.path ?? generatedCssBeside(definition))
    : undefined;
  const tailwindOut = requested.has("tailwind")
    ? (flags.tailwind ?? tailwind.path ?? generatedCssBeside(definition))
    : undefined;
  if (cssOut != null && cssOut === tailwindOut) {
    throw new Error(`css and tailwind would both write ${cssOut} — give one of them a path of its own`);
  }

  return {
    definition,
    cssOut,
    cssModes: modesFlag ?? css.modes ?? "nested",
    tailwindOut,
    tailwindModes: modesFlag ?? tailwind.modes ?? "nested",
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

/** `css: <path>` or `css: { path, modes }`, and the same for `tailwind`. */
function parseCssOutput(value: unknown, output: "css" | "tailwind"): {
  path?: string;
  modes?: ModeRendering;
} {
  if (value == null) return {};
  if (typeof value === "string") return { path: value };
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`dtg.config.yaml outputs.${output}: expected a path or { path, modes }`);
  }
  const block = value as Record<string, unknown>;
  if (output === "css" && block.format != null) {
    throw new Error(
      "dtg.config.yaml outputs.css.format was removed — the Tailwind file is an output of its own: `tailwind: <path>` under outputs",
    );
  }
  for (const key of Object.keys(block)) {
    if (key !== "path" && key !== "modes") {
      throw new Error(`dtg.config.yaml outputs.${output}: unknown key "${key}" (known: path, modes)`);
    }
  }
  return {
    path: block.path as string | undefined,
    modes: assertModeRendering(block.modes, `dtg.config.yaml outputs.${output}.modes`),
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
