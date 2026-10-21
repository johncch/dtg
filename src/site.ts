import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appShell } from "./app-shell.js";
import type { Gamut } from "./color-math.js";
import { DEFAULT_BACKGROUNDS, readBackgrounds } from "./dev-settings.js";
import type { DevState } from "./dev-state.js";
import type { ModeRendering } from "./emit.js";
import { resolveDefinition } from "./resolve.js";
import { openFile } from "./working-copy.js";

/**
 * A copy of the browsing app as plain files: the page, the bundle, and the
 * definition in `state.json`, which the page resolves as it loads. Any static
 * host serves it, from any folder. Visitors can edit an `editable` copy, in
 * their page alone; nothing is ever saved. Returns what the definition
 * resolved to, for the log.
 */
export function writeSite(
  definitionPath: string,
  gamut: Gamut,
  outDir: string,
  configPath: string,
  cssModes: ModeRendering,
  editable = false,
): string {
  const text = readFileSync(definitionPath, "utf8");
  // Resolved here too, so a broken definition fails the build rather than the published page.
  const resolved = resolveDefinition(text, [], gamut);
  const backgrounds = existsSync(configPath) ? readBackgrounds(readFileSync(configPath, "utf8")) : [];
  const state: DevState = {
    copy: openFile(text),
    notices: [],
    stale: false,
    gamut,
    // Only the file's name: the path on this machine is nobody's business once published.
    definitionPath: basename(definitionPath),
    configPath: "",
    backgrounds: backgrounds.length > 0 ? backgrounds : DEFAULT_BACKGROUNDS,
    cssModes,
  };
  const bundle = fileURLToPath(new URL("./ui", import.meta.url));
  if (!existsSync(join(bundle, "dtg-ui.js"))) throw new Error(`no browser bundle at ${bundle} — run the build first`);

  mkdirSync(outDir, { recursive: true });
  cpSync(bundle, join(outDir, "ui"), { recursive: true });
  writeFileSync(join(outDir, "index.html"), appShell(`dtg · ${basename(definitionPath)}`, "static", editable));
  writeFileSync(join(outDir, "state.json"), JSON.stringify(state));
  return `${resolved.systems.length} systems, ${resolved.statics.length} palette colors, ${resolved.roles.length} roles`;
}
