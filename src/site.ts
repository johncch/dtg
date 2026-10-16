import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appShell } from "./app-shell.js";
import type { Gamut } from "./color-math.js";
import { DEFAULT_BACKGROUNDS, readBackgrounds } from "./dev-settings.js";
import { buildLineage, resolveDefinition } from "./resolve.js";
import { buildSnapshot } from "./snapshot.js";

/**
 * A read-only copy of the browsing app as plain files: the page, the bundle,
 * and the definition resolved into `snapshot.json`. Any static host serves
 * it, from any folder. Returns what the definition resolved to, for the log.
 */
export function writeSite(definitionPath: string, gamut: Gamut, outDir: string, configPath: string): string {
  const text = readFileSync(definitionPath, "utf8");
  const resolved = resolveDefinition(text, [], gamut);
  const backgrounds = existsSync(configPath) ? readBackgrounds(readFileSync(configPath, "utf8")) : [];
  const snapshot = buildSnapshot({
    resolved,
    lineage: buildLineage(resolved),
    error: null,
    stale: false,
    gamut,
    changes: [],
    // Only the file's name: the path on this machine is nobody's business once published.
    definition: { path: basename(definitionPath), text },
    configPath: "",
    backgrounds: backgrounds.length > 0 ? backgrounds : DEFAULT_BACKGROUNDS,
  });
  const bundle = fileURLToPath(new URL("./ui", import.meta.url));
  if (!existsSync(join(bundle, "dtg-ui.js"))) throw new Error(`no browser bundle at ${bundle} — run the build first`);

  mkdirSync(outDir, { recursive: true });
  cpSync(bundle, join(outDir, "ui"), { recursive: true });
  writeFileSync(join(outDir, "index.html"), appShell(`dtg · ${basename(definitionPath)}`, "static"));
  writeFileSync(join(outDir, "snapshot.json"), JSON.stringify(snapshot));
  return `${resolved.systems.length} systems, ${resolved.statics.length} palette colors, ${resolved.roles.length} roles`;
}
