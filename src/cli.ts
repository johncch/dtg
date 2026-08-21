#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";
import { startDevServer } from "./dev-server.js";
import { dtcgClipped, emitCss, emitDtcg } from "./emit.js";
import { isOpaque } from "./color-math.js";
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
      dtcg: flagValue("--dtcg"),
      dtcgColorSpace: flagValue("--dtcg-color-space"),
    });
  } catch (e) {
    fail((e as Error).message);
  }

  if (command === "dev") {
    startDevServer(config.definition, Number(flagValue("--port") ?? "4401"));
  } else {
    const { definition, cssOut, cssFormat, dtcgOut, dtcgColorSpace } = config;
    const emitOnce = () => {
      const resolved = resolveDefinition(readFileSync(definition, "utf8"));
      mkdirSync(dirname(cssOut), { recursive: true });
      writeFileSync(cssOut, emitCss(resolved, cssFormat));
      if (dtcgOut) {
        mkdirSync(dirname(dtcgOut), { recursive: true });
        writeFileSync(
          dtcgOut,
          JSON.stringify(emitDtcg(resolved, dtcgColorSpace), null, 2) + "\n",
        );
      }
      const tokenCount = resolved.systems.reduce(
        (n, s) => n + s.steps.filter((st) => isOpaque(st.color)).length,
        0,
      );
      console.log(
        `${new Date().toLocaleTimeString()}  ${cssOut} (${cssFormat}): ${tokenCount} primitives + ${resolved.statics.length} statics, ${resolved.roles.length} roles × ${resolved.modes.length} modes`,
      );
      if (dtcgOut) {
        console.log(`  + ${dtcgOut} (${dtcgColorSpace})`);
        const clipped = dtcgClipped(resolved, dtcgColorSpace);
        if (clipped.length > 0) {
          const shown = clipped.slice(0, 5).join(", ");
          const rest = clipped.length > 5 ? `, +${clipped.length - 5} more` : "";
          console.log(
            `  warning: ${clipped.length} colour${clipped.length === 1 ? "" : "s"} gamut-mapped into ${dtcgColorSpace} for DTCG (${shown}${rest}) — set outputs.dtcg.colorSpace to match the Figma document's colour profile`,
          );
        }
      }
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
  emit [--live] [--css <path>] [--css-format <plain|tailwind>] [--dtcg <path>]
                                                  generate the CSS (and DTCG, when asked)
                                                  --live re-emits on every definition save
                                                  --css-format defaults to plain; tailwind wraps
                                                  primitives in @theme and adds utility wiring
                                                  --dtcg-color-space defaults to srgb; set it to
                                                  display-p3 to match a P3 Figma document
  dev  [--port <n>]                               browse the token system (default port 4401)

Definition resolution (both commands): --definition <file> if given; else the
\`definitions\` entry in dtg.yaml; else discover design-tokens/*.dtg.yaml.
CSS defaults to design-tokens/tokens.generated.css; DTCG is written only when
\`outputs.dtcg\` or --dtcg names a path. Every DTCG colour is written in one
space — Figma holds one colour profile per document, so it has to match.`);
  process.exit(command ? 1 : 0);
}
