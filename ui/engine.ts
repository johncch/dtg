import type { Color, Gamut } from "../src/color-math.js";
import type { DevState } from "../src/dev-state.js";
import { applyEdits, type Edit } from "../src/edit.js";
import { buildLineage, resolveDefinition, type Lineage, type ResolvedDefinition } from "../src/resolve.js";
import { buildSnapshot, type Snapshot } from "../src/snapshot.js";
import { changesOf, workingText } from "../src/working-copy.js";

/** A working copy that resolved, kept to draw from while a later one does not. */
export type Resolved = { resolved: ResolvedDefinition; lineage: Lineage };

/** What the page shows, and the definition it was resolved from, which CSS for a host is emitted from. */
export type Drawn = { snapshot: Snapshot; resolved: ResolvedDefinition };

/**
 * The app as `dtg dev`'s state draws it. When the working copy does not
 * resolve, the last copy that did is drawn with the error over it; with none
 * to fall back on, this throws.
 */
export function drawState(state: DevState, lastGood: Resolved | null): { snapshot: Snapshot; good: Resolved } {
  const { text } = workingText(state.copy);
  let good: Resolved;
  let error: string | null = null;
  try {
    const resolved = resolveDefinition(text, [], state.gamut);
    good = { resolved, lineage: buildLineage(resolved) };
  } catch (e) {
    if (!lastGood) throw e;
    good = lastGood;
    error = (e as Error).message;
  }
  const snapshot = buildSnapshot({
    resolved: { ...good.resolved, warnings: [...state.notices, ...good.resolved.warnings] },
    lineage: good.lineage,
    error,
    stale: state.stale,
    gamut: state.gamut,
    changes: changesOf(state.copy),
    undo: state.copy.steps.at(-1) ?? null,
    redo: state.copy.undone.at(-1) ?? null,
    definition: { path: state.definitionPath, text },
    configPath: state.configPath,
    backgrounds: state.backgrounds,
  });
  return { snapshot, good };
}

/**
 * The app as it would be drawn with `edits` made on top of the working copy
 * `base` was drawn from. Nothing is kept. Throws with the reason when an edit
 * cannot be made or the result does not resolve.
 */
export function previewOf(base: Snapshot, edits: Edit[]): Drawn {
  const resolved = resolveDefinition(applyEdits(base.definition.text, edits), [], base.gamut);
  const snapshot = buildSnapshot({
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
  return { snapshot, resolved };
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
