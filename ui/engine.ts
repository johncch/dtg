import type { Color, Gamut } from "../src/color-math.js";
import { applyEdits, type Edit } from "../src/edit.js";
import { buildLineage, resolveDefinition } from "../src/resolve.js";
import { buildSnapshot, type Snapshot } from "../src/snapshot.js";

/**
 * The app as it would be drawn with `edits` made on top of the working copy
 * `base` was drawn from. Nothing is kept. Throws with the reason when an edit
 * cannot be made or the result does not resolve.
 */
export function previewOf(base: Snapshot, edits: Edit[]): Snapshot {
  const resolved = resolveDefinition(applyEdits(base.definition.text, edits), [], base.gamut);
  return buildSnapshot({
    resolved,
    lineage: buildLineage(resolved),
    error: null,
    stale: base.stale,
    gamut: base.gamut,
    changes: base.changes,
    undo: base.undo,
    redo: base.redo,
    definition: base.definition,
    configPath: base.configPath,
    backgrounds: base.backgrounds.map(({ name, written }) => ({ name, color: written })),
  });
}

/** The color `ref` comes to in the definition `text`, without anything demanding it. */
export function probeOf(text: string, gamut: Gamut, ref: string): { color: Color } | { error: string } {
  try {
    const [probe] = resolveDefinition(text, [], gamut, [ref]).probed;
    return probe;
  } catch (e) {
    return { error: (e as Error).message };
  }
}
