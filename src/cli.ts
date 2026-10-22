#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { defaultDefinitionPath, loadConfig, writeStarter } from "./config.js";
import { startDevServer } from "./dev-server.js";
import { writeOutputs } from "./outputs.js";
import { resolveDefinition } from "./resolve.js";
import { writeSite } from "./site.js";
import { watchDefinition } from "./watch.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const args = process.argv.slice(2);
const command = args[0];

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value == null || value.startsWith("--")) {
    fail(`${name} requires a value`);
  }
  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Where the definition should live: `--definition`, or a question whose
 * Enter takes the default. Without a terminal, the default.
 */
async function askDefinitionPath(): Promise<string> {
  const given = flagValue("--definition");
  if (given) return given;
  const fallback = defaultDefinitionPath();
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Where should the definition live? (${fallback}) `)).trim();
  rl.close();
  return answer || fallback;
}

if (command === "init") {
  const definition = await askDefinitionPath();
  let definitionWritten = false;
  try {
    ({ definitionWritten } = writeStarter(definition));
  } catch (e) {
    fail((e as Error).message);
  }
  console.log(
    definitionWritten
      ? `wrote dtg.config.yaml and a starter ${definition} — \`dtg dev\` opens it`
      : `wrote dtg.config.yaml, pointing at the ${definition} already here — \`dtg dev\` opens it`,
  );
} else if (command === "emit") {
  fail("`dtg emit` is now `dtg build` — the same flags, the same outputs");
} else if (command === "docs") {
  const out = flagValue("--out") ?? fail("docs: name the folder to write with --out <dir>");
  try {
    const config = loadConfig({ definition: flagValue("--definition") });
    const editable = args.includes("--editable");
    console.log(`${writeSite(config.definition, config.gamut, out, "dtg.config.yaml", config.cssModes, editable)}\n  → ${out}/index.html`);
  } catch (e) {
    fail((e as Error).message);
  }
} else if (command === "dev" || command === "build") {
  let config;
  try {
    config = loadConfig({
      definition: flagValue("--definition"),
      css: flagValue("--css"),
      cssFormat: flagValue("--css-format"),
      cssModes: flagValue("--css-modes"),
      scss: flagValue("--scss"),
      dtcg: flagValue("--dtcg"),
      dtcgColorSpace: flagValue("--dtcg-color-space"),
    });
  } catch (e) {
    fail((e as Error).message);
  }

  if (command === "dev") {
    if (args.includes("--emit")) fail("`dtg dev --emit` is now `dtg dev --build`");
    startDevServer(
      config.definition,
      Number(flagValue("--port") ?? "4401"),
      config.gamut,
      config.cssModes,
      args.includes("--build") ? config : null,
    );
  } else {
    const { definition } = config;

    const emitOnce = () =>
      writeOutputs(
        config,
        resolveDefinition(readFileSync(config.definition, "utf8"), [], config.gamut),
      );

    if (args.includes("--live")) fail("`dtg build --live` is now `dtg build --watch`");
    if (args.includes("--watch")) {
      const emitCaught = () => {
        try {
          emitOnce();
        } catch (e) {
          console.error((e as Error).message);
        }
      };
      emitCaught();
      watchDefinition(definition, emitCaught);
      console.log(`watching ${definition} — Ctrl-C to stop`);
    } else {
      try {
        emitOnce();
      } catch (e) {
        fail((e as Error).message);
      }
    }
  }
} else if (command === "--version" || command === "-v") {
  console.log(version);
} else {
  const askedForHelp = command == null || command === "--help" || command === "-h";
  if (!askedForHelp) console.error(`unknown command "${command}"\n`);
  console.log(`dtg ${version}

usage: dtg <command> [flags]

commands
  init      write a starter definition and dtg.config.yaml in this folder
  dev       browse and edit the definition in a browser
  build     write the configured outputs
  docs      write a copy of the browser as static files, to publish

init
  --definition <file>         where to put the definition (asked otherwise)

dev
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

dev, build and docs
  --definition <file>         the definition to read (default: \`definitions\`
                              in dtg.config.yaml)

outputs (build, and dev --build)
  --css <path>                write CSS here
  --css-format <plain|tailwind>
                              plain (default), or tailwind: primitives in
                              @theme plus utility wiring
  --css-modes <nested|flat>   nested (default): one selector per mode;
                              flat: the mode folded into each name
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
  process.exit(askedForHelp ? 0 : 1);
}
