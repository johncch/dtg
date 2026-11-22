import type { Edit } from "../src/edit.js";
import type { SnapshotSystem } from "../src/snapshot.js";

/** The system's `publish` list set to `selectors`: one that is only a number is written as a number. */
export function emitEdit(system: SnapshotSystem, selectors: string[]): Edit {
  const items = selectors.map((selector) => (/^-?\d+(\.\d+)?$/.test(selector) ? Number(selector) : selector));
  return { action: "set", target: { kind: "emit", system: system.system }, value: JSON.stringify(items) };
}
