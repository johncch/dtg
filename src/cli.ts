#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";
import { startDevServer } from "./dev-server.js";
import { dtcgClipped, emitCss, emitDtcg, emitScss } from "./emit.js";
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
      cssModes: flagValue("--css-modes"),
      scss: flagValue("--scss"),
      dtcg: flagValue("--dtcg"),
      dtcgColorSpace: flagValue("--dtcg-color-space"),
    });
  } catch (e) {
    fail((e as Error).message);
  }

  if (command === "dev") {
    startDevServer(config.definition, Number(flagValue("--port") ?? "4401"));
  } else {
    const {
      definition, cssOut, cssFormat, cssModes, scssOut, dtcgOut, dtcgColorSpace,
    } = config;

    const emitOnce = () => {
      const resolved = resolveDefinition(readFileSync(definition, "utf8"));
      const written: string[] = [];
      const write = (path: string, contents: string, note: string) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents);
        written.push(`${path} (${note})`);
      };

      if (cssOut) {
        write(
          cssOut,
          emitCss(resolved, cssFormat, cssModes),
          `${cssFormat}, ${cssModes} modes`,
        );
      }
      if (scssOut) write(scssOut, emitScss(resolved), "scss, flat");
      if (dtcgOut) {
        write(
          dtcgOut,
          JSON.stringify(emitDtcg(resolved, dtcgColorSpace), null, 2) + "\n",
          `dtcg, ${dtcgColorSpace}`,
        );
      }

      const tokenCount = resolved.systems.reduce(
        (n, s) => n + s.steps.filter((st) => isOpaque(st.color)).length,
        0,
      );
      const roles =
        resolved.modes.length > 1
          ? `${resolved.roles.length} roles × ${resolved.modes.length} modes`
          : `${resolved.roles.length} roles`;
      console.log(
        `${new Date().toLocaleTimeString()}  ${tokenCount} primitives + ${resolved.statics.length} statics, ${roles}`,
      );
      for (const w of written) console.log(`  → ${w}`);

      if (dtcgOut) {
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
  dev  [--port <n>]                               browse the token system (default port 4401)

Definition resolution (both commands): --definition <file> if given; else the
\`definitions\` entry in dtg.yaml; else discover design-tokens/*.dtg.yaml.
\`outputs\` is a set: name nothing and you get CSS at
design-tokens/tokens.generated.css; name any of css/scss/dtcg — in dtg.yaml or
as a flag — and you get exactly those. Every DTCG colour is written in one
space, because Figma holds one colour profile per document.`);
  process.exit(command ? 1 : 0);
}
