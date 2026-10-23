import { createContext, useContext } from "react";
import type { BackgroundOverrides } from "../src/dev-settings.js";
import type { Edit } from "../src/edit.js";

/**
 * Everything the page can do to the working copy and the settings. Each
 * command settles when it is done and rejects with the reason it was not.
 * The new state arrives on its own, the way any other change does.
 */
export type Store = {
  /** A new step of unsaved changes, which one undo takes back. */
  commit(edits: Edit[]): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  discard(): Promise<void>;
  /** Write the unsaved changes to the definition file; null where there is no file to write. */
  save: (() => Promise<void>) | null;
  /** Write the background overrides to `dtg.config.yaml`; null where there is no file to write. */
  setBackgroundOverrides: ((overrides: BackgroundOverrides) => Promise<void>) | null;
};

const StoreContext = createContext<Store | null>(null);

export const StoreProvider = StoreContext.Provider;

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside a StoreProvider");
  return store;
}

/** The store behind `dtg edit`: each command asks the server, whose new state comes back over the event stream. */
export const bridgeStore: Store = {
  commit: (edits) => post("/api/edits", { edits }),
  undo: () => post("/api/undo"),
  redo: () => post("/api/redo"),
  discard: () => post("/api/discard"),
  save: () => post("/api/save"),
  setBackgroundOverrides: (overrides) => post("/api/backgrounds", { overrides }),
};

async function post(path: string, body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (response.ok) return;
  const answer = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(answer.error ?? `the server answered ${response.status}`);
}
