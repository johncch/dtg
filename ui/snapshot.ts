import { useEffect, useMemo, useState } from "react";
import type { DevState } from "../src/dev-state.js";
import type { Snapshot } from "../src/snapshot.js";
import { discard, redo, undo, withEdits, type WorkingCopy } from "../src/working-copy.js";
import { drawState, type Resolved } from "./engine.js";
import { STATIC } from "./mode.js";
import { bridgeStore, type Store } from "./store.js";

export type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; snapshot: Snapshot }
  | { status: "failed"; message: string };

type Loaded =
  | { status: "loading" }
  | { status: "ready"; dev: DevState; snapshot: Snapshot; good: Resolved }
  | { status: "failed"; message: string };

/** `dev` drawn, falling back on what last resolved when it does not. */
function drawn(dev: DevState, previous: Loaded): Loaded {
  try {
    const { snapshot, good } = drawState(dev, previous.status === "ready" ? previous.good : null);
    return { status: "ready", dev, snapshot, good };
  } catch (e) {
    return { status: "failed", message: (e as Error).message };
  }
}

/**
 * The working copy, drawn, and the store that changes it. `dtg dev` keeps the
 * copy on the server and says when it changes; a static copy reads it from
 * `state.json` and keeps every edit in the page, where a reload drops them.
 */
export function useSnapshot(): { state: SnapshotState; store: Store } {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  const store = useMemo<Store>(() => {
    if (!STATIC) return bridgeStore;
    const change = (next: (copy: WorkingCopy) => WorkingCopy) => {
      setLoaded((previous) =>
        previous.status === "ready" ? drawn({ ...previous.dev, copy: next(previous.dev.copy) }, previous) : previous,
      );
      return Promise.resolve();
    };
    return {
      commit: (edits) => change((copy) => withEdits(copy, edits)),
      undo: () => change(undo),
      redo: () => change(redo),
      discard: () => change(discard),
      save: null,
      setBackgrounds: null,
    };
  }, []);

  useEffect(() => {
    const load = () => {
      // A static copy reads the file written beside it, relative to wherever it is served from.
      fetch(STATIC ? "state.json" : "/api/state")
        .then((response) => {
          if (!response.ok) throw new Error(`the server answered ${response.status}`);
          return response.json() as Promise<DevState>;
        })
        .then(
          (dev) => setLoaded((previous) => drawn(dev, previous)),
          (error: Error) => setLoaded({ status: "failed", message: error.message }),
        );
    };
    load();
    if (STATIC) return;

    const live = new EventSource("/events");
    live.onmessage = (event) => {
      if (event.data === "reload") location.reload();
      else load();
    };
    // A dropped stream means the server restarted with new code, which may
    // include a new bundle; the browser reconnects on its own.
    let dropped = false;
    live.onerror = () => {
      dropped = true;
    };
    live.onopen = () => {
      if (dropped) location.reload();
    };
    // A page frozen into the back/forward cache keeps its stream open, and six
    // open streams exhaust the browser's per-origin connection limit.
    const close = () => live.close();
    addEventListener("pagehide", close);
    return () => {
      removeEventListener("pagehide", close);
      live.close();
    };
  }, []);

  const state: SnapshotState = loaded.status === "ready" ? { status: "ready", snapshot: loaded.snapshot } : loaded;
  return { state, store };
}
