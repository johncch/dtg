#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";
import { startDevServer } from "./dev-server.js";
import { emitCss, emitFigma } from "./emit.js";
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
      figma: flagValue("--figma"),
    });
  } catch (e) {
    fail((e as Error).message);
  }

  if (command === "dev") {
    startDevServer(config.definition, Number(flagValue("--port") ?? "4401"));
  } else {
    const { definition, cssOut, figmaOut } = config;
    const emitOnce = () => {
      const resolved = resolveDefinition(readFileSync(definition, "utf8"));
      mkdirSync(dirname(cssOut), { recursive: true });
      mkdirSync(dirname(figmaOut), { recursive: true });
      writeFileSync(cssOut, emitCss(resolved));
      writeFileSync(
        figmaOut,
        JSON.stringify(emitFigma(resolved), null, 2) + "\n",
      );
      const tokenCount = resolved.systems.reduce(
        (n, s) => n + s.steps.filter((st) => st.opaque).length,
        0,
      );
      console.log(
        `${new Date().toLocaleTimeString()}  ${cssOut}: ${tokenCount} primitives + ${resolved.statics.length} statics, ${resolved.roles.length} roles × ${resolved.modes.length} modes`,
      );
      console.log(`  + ${figmaOut}`);
      for (const w of resolved.warnings) console.log(`  warning: ${w}`);
    };

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
  emit [--live] [--css <path>] [--figma <path>]   generate the CSS + Figma payload
                                                  --live re-emits on every definition save
  dev  [--port <n>]                               browse the token system (default port 4401)

Definition resolution (both commands): --definition <file> if given; else the
\`definitions\` entry in dtg.yaml; else discover design-tokens/*.dtg.yaml.
Output defaults: design-tokens/tokens.generated.css, design-tokens/figma.json
(overridable in dtg.yaml \`outputs\` or via flags).`);
  process.exit(command ? 1 : 0);
}
