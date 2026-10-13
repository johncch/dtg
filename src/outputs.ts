import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isOpaque } from "./color-math.js";
import type { DtgConfig } from "./config.js";
import { dtcgClipped, emitCss, emitDtcg, emitScss } from "./emit.js";
import type { ResolvedDefinition } from "./resolve.js";

/** Write every configured output for a resolved definition, and say what was written. */
export function writeOutputs(config: DtgConfig, resolved: ResolvedDefinition): void {
  const { cssOut, cssFormat, cssModes, scssOut, dtcgOut, dtcgColorSpace } = config;
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
        `  warning: ${clipped.length} color${clipped.length === 1 ? "" : "s"} gamut-mapped into ${dtcgColorSpace} for DTCG (${shown}${rest}) — set outputs.dtcg.colorSpace to match the Figma document's color profile`,
      );
    }
  }
  for (const w of resolved.warnings) console.log(`  warning: ${w}`);
}
