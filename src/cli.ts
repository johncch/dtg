#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { startDevServer } from "./dev-server.js";
import { writeOutputs } from "./outputs.js";
import { resolveDefinition } from "./resolve.js";
import { watchDefinition } from "./watch.js";

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

if (command === "dev" || command === "emit") {
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
      gamut: flagValue("--gamut"),
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
} else {
  console.log(`usage:
  emit [--live] [--css <path>] [--scss <path>] [--dtcg <path>]
                                                  write the configured outputs
                                                  --css-format <plain|tailwind>
                                                  --live re-emits on every definition save
                                                  --css-format defaults to plain; tailwind wraps
                                                  primitives in @theme and adds utility wiring
                                                  --css-modes defaults to nested (one selector per
                                                  mode); flat folds the mode into the name instead
                                                  --scss <file> also writes flat Sass variables
                                                  --dtcg-color-space defaults to srgb; set it to
                                                  display-p3 to match a P3 Figma document
  dev  [--port <n>] [--emit]                      browse and edit the token system (default
                                                  port 4401); --emit also writes the configured
                                                  outputs, at startup and whenever the
                                                  definition file changes

Definition resolution (both commands): --definition <file> if given; else the
\`definitions\` entry in dtg.yaml; else discover design-tokens/*.dtg.yaml.
\`outputs\` is a set: name nothing and you get CSS at
design-tokens/tokens.generated.css; name any of css/scss/dtcg — in dtg.yaml or
as a flag — and you get exactly those. Every DTCG color is written in one
space, because Figma holds one color profile per document.

--gamut <srgb|display-p3> (both commands; \`gamut\` in dtg.yaml; default
display-p3) is the widest colors the project means to author. The picker
stops at it and a color above it warns; nothing is altered.`);
  process.exit(command ? 1 : 0);
}
