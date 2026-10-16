import { createContext, useContext } from "react";
import type { EditTarget } from "../src/edit.js";
import type { Change } from "../src/working-copy.js";

const UnsavedChanges = createContext<Change[]>([]);

export const UnsavedChangesProvider = UnsavedChanges.Provider;

/** What the definition file has at a target, when that differs from the working copy; null when they agree. */
export function useValueInFile(target: EditTarget): string | null {
  const key = JSON.stringify(target);
  const change = useContext(UnsavedChanges).find(
    (candidate) => candidate.action === "set" && JSON.stringify(candidate.target) === key,
  );
  return change?.action === "set" ? change.from : null;
}
