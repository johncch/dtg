import { isMap, isScalar, parseDocument } from "yaml";
import { parseColor } from "./color-math.js";

/** A page color to look at the tokens against in `dtg dev`. `color` is as written: hex or `oklch()`. */
export type Background = { name: string; color: string };

/** What the app offers when `dtg.config.yaml` names no backgrounds. */
export const DEFAULT_BACKGROUNDS: Background[] = [{ name: "white", color: "#ffffff" }];

const BACKGROUNDS_KEY = ["dev", "backgrounds"];

/** Throws with a human message on a list the app could not offer. */
export function assertBackgrounds(backgrounds: Background[]): void {
  const seen = new Set<string>();
  for (const { name, color } of backgrounds) {
    if (name.trim() === "") throw new Error("dev.backgrounds: a background needs a name");
    if (seen.has(name)) throw new Error(`dev.backgrounds: "${name}" appears twice`);
    seen.add(name);
    parseColor(color, `dev.backgrounds.${name}`);
  }
}

/**
 * The backgrounds a `dtg.config.yaml` declares under `dev.backgrounds`, in the order
 * written; none when it declares none. Read from the document rather than
 * the parsed value, because a parsed map hands number-like names back sorted.
 */
export function readBackgrounds(configText: string): Background[] {
  const written = parseDocument(configText).getIn(BACKGROUNDS_KEY, true);
  if (written == null || (isScalar(written) && written.value == null)) return [];
  if (!isMap(written)) {
    throw new Error("dev.backgrounds: expected a map of name: color");
  }
  const backgrounds = written.items.map((pair) => ({
    name: String(isScalar(pair.key) ? pair.key.value : pair.key),
    color: String(isScalar(pair.value) ? pair.value.value : pair.value),
  }));
  assertBackgrounds(backgrounds);
  return backgrounds;
}

/** A `dtg.config.yaml` with its backgrounds replaced, and everything else it says kept. */
export function withBackgrounds(configText: string, backgrounds: Background[]): string {
  assertBackgrounds(backgrounds);
  const doc = parseDocument(configText);
  if (backgrounds.length > 0) {
    doc.setIn(
      BACKGROUNDS_KEY,
      doc.createNode(new Map(backgrounds.map(({ name, color }) => [name, color]))),
    );
  } else if (doc.hasIn(BACKGROUNDS_KEY)) {
    doc.deleteIn(BACKGROUNDS_KEY);
    const dev = doc.get("dev", true);
    if (isMap(dev) && dev.items.length === 0) doc.delete("dev");
  }
  return doc.toString();
}
