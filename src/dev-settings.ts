import { isMap, isScalar, parseDocument } from "yaml";

/**
 * Editor backgrounds a project has set by hand, by mode: a color (hex or
 * `oklch()`) or a ref into the definition, as written. A ref resolves in the
 * mode it is set for. Modes not named here get the background their scheme
 * implies. What a value comes to is worked out where the definition is, in
 * the snapshot; here it only has to be a string.
 */
export type BackgroundOverrides = Record<string, string>;

const BACKGROUNDS_KEY = ["editor", "backgrounds"];

/** Throws with a human message on an override that could not be written. */
export function assertBackgroundOverrides(overrides: BackgroundOverrides): void {
  for (const [mode, value] of Object.entries(overrides)) {
    if (mode.trim() === "") throw new Error("editor.backgrounds: a background needs a mode");
    if (value.trim() === "") throw new Error(`editor.backgrounds.${mode}: a background needs a color or a ref`);
  }
}

/**
 * The backgrounds a `dtg.config.yaml` sets under `editor.backgrounds`, by mode;
 * none when it sets none. Read from the document rather than the parsed
 * value, because a parsed map hands number-like names back sorted.
 */
export function readBackgroundOverrides(configText: string): BackgroundOverrides {
  const written = parseDocument(configText).getIn(BACKGROUNDS_KEY, true);
  if (written == null || (isScalar(written) && written.value == null)) return {};
  if (!isMap(written)) {
    throw new Error("editor.backgrounds: expected a map of mode: color or ref");
  }
  const overrides: BackgroundOverrides = {};
  for (const pair of written.items) {
    const mode = String(isScalar(pair.key) ? pair.key.value : pair.key);
    overrides[mode] = String(isScalar(pair.value) ? pair.value.value : pair.value);
  }
  assertBackgroundOverrides(overrides);
  return overrides;
}

/** A `dtg.config.yaml` with its background overrides replaced, and everything else it says kept. */
export function withBackgroundOverrides(configText: string, overrides: BackgroundOverrides): string {
  assertBackgroundOverrides(overrides);
  const doc = parseDocument(configText);
  if (Object.keys(overrides).length > 0) {
    // A file that is `{}` would otherwise keep everything written into it on one line.
    if (isMap(doc.contents) && doc.contents.items.length === 0) doc.contents.flow = false;
    doc.setIn(BACKGROUNDS_KEY, doc.createNode(new Map(Object.entries(overrides))));
  } else if (doc.hasIn(BACKGROUNDS_KEY)) {
    doc.deleteIn(BACKGROUNDS_KEY);
    const editor = doc.get("editor", true);
    if (isMap(editor) && editor.items.length === 0) doc.delete("editor");
    if (isMap(doc.contents) && doc.contents.items.length === 0) return "";
  }
  return doc.toString();
}
