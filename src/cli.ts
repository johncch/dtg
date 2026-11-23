#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import {
  defaultDefinitionPath,
  hostCss,
  loadConfig,
  STARTS,
  writeStarter,
  type Start,
} from "./config.js";
import { compareStylesheets, formatComparison } from "./engine/compare.js";
import { startDevServer } from "./server/dev-server.js";
import { emitHostCss } from "./engine/emit.js";
import { writeOutputs } from "./outputs.js";
import { resolveDefinition } from "./engine/resolve.js";
import { writeSite } from "./server/site.js";
import { watchDefinition } from "./server/watch.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const [command, ...rest] = process.argv.slice(2);

const DEFINITION = { definition: { type: "string" } } as const;
const OUTPUTS = {
  css: { type: "string" },
  tailwind: { type: "string" },
  "css-modes": { type: "string" },
  scss: { type: "string" },
  dtcg: { type: "string" },
  "dtcg-color-space": { type: "string" },
} as const;

const REMOVED_FLAGS: Record<string, string> = {
  "--css-format": "--css-format was removed — `--tailwind <path>` writes the Tailwind file, and `--css` plain CSS",
  "--live": "`dtg build --live` is now `dtg build --watch`",
};

/** This command's flags, refusing any it doesn't take, and at most `positionals` bare arguments. */
function parse<const Options extends ParseArgsOptionsConfig>(options: Options, positionals = 0) {
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options, allowPositionals: true });
  } catch (e) {
    const { code, message } = e as { code?: string; message: string };
    if (code !== "ERR_PARSE_ARGS_UNKNOWN_OPTION") fail(`${command}: ${message}`);
    const flag = /'([^']+)'/.exec(message)?.[1] ?? "";
    fail(REMOVED_FLAGS[flag] ?? `${command}: unknown flag ${flag} — \`dtg --help\` lists each command's flags`);
  }
  const extra = parsed.positionals[positionals];
  if (extra != null) fail(`${command}: unexpected "${extra}"`);
  return parsed;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Where the definition should live: `--definition`, or a question whose
 * Enter takes the default. Without a terminal, the default.
 */
async function askDefinitionPath(given: string | undefined): Promise<string> {
  if (given) return given;
  const fallback = defaultDefinitionPath();
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Where should the definition live? (${fallback}) `)).trim();
  rl.close();
  return answer || fallback;
}

function isStart(name: string): name is Start {
  return name in STARTS;
}

/**
 * What the definition starts as: `--from`, or a question whose Enter takes
 * the starter. Without a terminal, the starter.
 */
async function askStart(given: string | undefined): Promise<Start> {
  if (given != null) {
    if (!isStart(given)) fail(`--from: unknown "${given}" (known: ${Object.keys(STARTS).join(", ")})`);
    return given;
  }
  if (!process.stdin.isTTY) return "starter";
  const names = Object.keys(STARTS) as Start[];
  const choices = names.map((name, i) => `  ${i + 1}. ${STARTS[name]}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Start from:\n${choices.join("\n")}\n[1] `)).trim();
  rl.close();
  if (answer === "") return "starter";
  if (isStart(answer)) return answer;
  const picked = names[Number(answer) - 1];
  if (picked == null) fail(`init: no choice "${answer}"`);
  return picked;
}

/** The config, with the output flags `edit` and `build` both take laid over it. */
function configFrom(values: { definition?: string } & { [Flag in keyof typeof OUTPUTS]?: string }) {
  try {
    return loadConfig({
      definition: values.definition,
      css: values.css,
      cssModes: values["css-modes"],
      tailwind: values.tailwind,
      scss: values.scss,
      dtcg: values.dtcg,
      dtcgColorSpace: values["dtcg-color-space"],
    });
  } catch (e) {
    fail((e as Error).message);
  }
}

/** `dtg init`'s questions and files, and what it wrote, as a line to print. */
async function setUp(given: { definition?: string; from?: string }): Promise<string> {
  const definition = await askDefinitionPath(given.definition);
  const from = await askStart(given.from);
  let definitionWritten = false;
  try {
    ({ definitionWritten } = writeStarter(definition, from));
  } catch (e) {
    fail((e as Error).message);
  }
  return definitionWritten
    ? `wrote dtg.config.yaml and ${from === "starter" ? "a starter" : `the ${from} definition as`} ${definition}`
    : `wrote dtg.config.yaml, pointing at the ${definition} already here`;
}

/** Whether to set up a project where `dtg edit` found none. Without a terminal there is no one to ask. */
async function askSetUp(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("No dtg project here. Set one up? (Y/n) ")).trim().toLowerCase();
  rl.close();
  return answer === "" || answer === "y" || answer === "yes";
}

if (rest.includes("--help") || rest.includes("-h")) {
  printHelp(0);
} else if (command === "init") {
  const { values } = parse({ ...DEFINITION, from: { type: "string" } });
  console.log(`${await setUp(values)} — \`dtg edit\` opens it`);
} else if (command === "emit") {
  fail("`dtg emit` is now `dtg build` — the same flags, the same outputs");
} else if (command === "skill") {
  const sub = parse({}, 1).positionals[0] ?? "show";
  const skillFile = (name: string) => readFileSync(new URL(`../skill/${name}`, import.meta.url), "utf8");
  if (sub === "show") {
    process.stdout.write(skillFile("guide.md"));
  } else if (sub === "setup") {
    const target = ".claude/skills/dtg/SKILL.md";
    const stub = skillFile("SKILL.md");
    if (existsSync(target)) {
      if (readFileSync(target, "utf8") !== stub) fail(`${target} is already here and differs — remove it to set up again`);
      console.log(`${target} is already set up`);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, stub);
      console.log(`wrote ${target} — Claude Code in this project now reads dtg's guide when it works on colors`);
    }
  } else {
    fail(`skill: unknown "${sub}" (known: show, setup)`);
  }
} else if (command === "compare") {
  const { values, positionals } = parse(DEFINITION, 1);
  const stylesheet = positionals[0] ?? fail("compare: name the stylesheet, as `dtg compare <file>`");
  try {
    const config = loadConfig({ definition: values.definition });
    const resolved = resolveDefinition(readFileSync(config.definition, "utf8"), [], config.gamut);
    const built = emitHostCss(resolved, { names: hostCss(config).names, modes: "nested" });
    console.log(formatComparison(compareStylesheets(readFileSync(stylesheet, "utf8"), built, resolved.modes), stylesheet));
    for (const warning of resolved.warnings) console.log(`  warning: ${warning}`);
  } catch (e) {
    fail((e as Error).message);
  }
} else if (command === "docs") {
  const { values } = parse({ ...DEFINITION, out: { type: "string" }, editable: { type: "boolean" } });
  const out = values.out ?? fail("docs: name the folder to write with --out <dir>");
  try {
    const config = loadConfig({ definition: values.definition });
    console.log(`${writeSite(config.definition, config.gamut, out, "dtg.config.yaml", hostCss(config), values.editable ?? false)}\n  → ${out}/index.html`);
  } catch (e) {
    fail((e as Error).message);
  }
} else if (command === "edit") {
  const { values } = parse({ ...DEFINITION, ...OUTPUTS, port: { type: "string" }, build: { type: "boolean" } });
  // `dtg edit` in a folder with no project sets one up the way `dtg init` does, then opens it.
  if (values.definition == null && !existsSync("dtg.config.yaml")) {
    if (!(await askSetUp())) fail("no dtg project here — `dtg init` sets one up, or pass --definition");
    console.log(await setUp({}));
  }
  const config = configFrom(values);
  const port = Number(values.port ?? "4401");
  if (!Number.isInteger(port)) fail(`edit: --port takes a number, not "${values.port}"`);
  startDevServer(config.definition, port, config.gamut, hostCss(config), values.build ? config : null);
} else if (command === "build") {
  const { values } = parse({ ...DEFINITION, ...OUTPUTS, watch: { type: "boolean" } });
  const config = configFrom(values);
  const emitOnce = () => writeOutputs(config, resolveDefinition(readFileSync(config.definition, "utf8"), [], config.gamut));
  if (values.watch) {
    const emitCaught = () => {
      try {
        emitOnce();
      } catch (e) {
        console.error((e as Error).message);
      }
    };
    emitCaught();
    watchDefinition(config.definition, emitCaught);
    console.log(`watching ${config.definition} — Ctrl-C to stop`);
  } else {
    try {
      emitOnce();
    } catch (e) {
      fail((e as Error).message);
    }
  }
} else if (command === "--version" || command === "-v") {
  console.log(version);
} else {
  const askedForHelp = command == null || command === "--help" || command === "-h";
  if (!askedForHelp) console.error(`unknown command "${command}"\n`);
  printHelp(askedForHelp ? 0 : 1);
}

function printHelp(exitCode: number): never {
  console.log(`dtg ${version}

usage: dtg <command> [flags]

commands
  init      write a starter definition and dtg.config.yaml in this folder
  edit      open the definition in the editor; in a folder with no project,
            offers to set one up first
  build     write the configured outputs
  docs      write a copy of the editor as static files, to publish
  compare   compare a stylesheet with what build would write: every color,
            in every mode, with var() chains followed
  skill     print the guide dtg gives coding agents; \`skill setup\` installs
            it as a Claude Code skill in this project

init
  --definition <file>         where to put the definition (asked otherwise)
  --from <starter|blank|tailwind|material>
                              what the definition starts as (asked otherwise)

edit
  --port <n>                  port to serve on (default 4401)
  --build                     also write the outputs, at startup and whenever
                              the definition file changes

build
  --watch                     keep running; write again on every change to
                              the definition file

docs
  --out <dir>                 the folder to write: index.html, state.json
                              and ui/. Serve it from any static host, at any
                              path; it reads nothing at runtime but its own files
  --editable                  let visitors edit the colors in their page; edits
                              are never saved, and a reload starts over

edit, build, docs and compare
  --definition <file>         the definition to read (default: \`definitions\`
                              in dtg.config.yaml)

outputs (build, and edit --build)
  --css <path>                write CSS here
  --tailwind <path>           write CSS for a Tailwind v4 build here:
                              primitives in @theme plus utility wiring
  --css-modes <nested|flat>   for both: nested (default), one selector per
                              mode; flat, the mode folded into each name
  --scss <path>               write flat Sass variables here
  --dtcg <path>               write DTCG JSON here
  --dtcg-color-space <srgb|display-p3>
                              the one space every DTCG color is written in
                              (default srgb); match your Figma document

  Outputs are a set. Name none and you get CSS beside the definition,
  named after it: colors.dtg.yaml → colors.generated.css. Name any, here
  or under \`outputs\` in dtg.config.yaml, and you get exactly those.

other
  -v, --version               print the version
  -h, --help                  print this`);
  process.exit(exitCode);
}
