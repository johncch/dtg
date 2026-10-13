#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadConfig, writePlaceholderConfig } from "./config.js";
import { startDevServer } from "./dev-server.js";
import { writeOutputs } from "./outputs.js";
import { resolveDefinition } from "./resolve.js";
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

if (command === "init") {
  try {
    writePlaceholderConfig();
  } catch (e) {
    fail((e as Error).message);
  }
  console.log("wrote dtg.yaml — point `definitions` and `outputs` at your files");
} else if (command === "dev" || command === "emit") {
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
    startDevServer(
      config.definition,
      Number(flagValue("--port") ?? "4401"),
      config.gamut,
      args.includes("--emit") ? config : null,
    );
  } else {
    const { definition } = config;

    const emitOnce = () =>
      writeOutputs(
        config,
        resolveDefinition(readFileSync(config.definition, "utf8"), [], config.gamut),
      );

    if (args.includes("--live")) {
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
  init      write a placeholder dtg.yaml in this folder
  dev       browse and edit the definition in a browser
  emit      write the configured outputs

dev
  --port <n>                  port to serve on (default 4401)
  --emit                      also write the outputs, at startup and whenever
                              the definition file changes

emit
  --live                      keep running; write again on every change to
                              the definition file

dev and emit
  --definition <file>         the definition to read (default: \`definitions\`
                              in dtg.yaml)

outputs (emit, and dev --emit)
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

  Outputs are a set. Name none and you get CSS at tokens.generated.css
  beside the definition. Name any, here or under \`outputs\` in dtg.yaml,
  and you get exactly those.

other
  -v, --version               print the version
  -h, --help                  print this`);
  process.exit(askedForHelp ? 0 : 1);
}
