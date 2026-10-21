import { useEffect, useState } from "react";
import type { DevState } from "../src/dev-state.js";
import type { Snapshot } from "../src/snapshot.js";
import { drawState, type Resolved } from "./engine.js";
import { STATIC } from "./mode.js";

export type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; snapshot: Snapshot }
  | { status: "failed"; message: string };

export function useSnapshot(): SnapshotState {
  const [state, setState] = useState<SnapshotState>({ status: "loading" });

  useEffect(() => {
    let lastGood: Resolved | null = null;
    const draw = (state: DevState): Snapshot => {
      const drawn = drawState(state, lastGood);
      lastGood = drawn.good;
      return drawn.snapshot;
    };
    const load = () => {
      // A static copy reads the file written beside it, relative to wherever it is served from.
      fetch(STATIC ? "snapshot.json" : "/api/state")
        .then((response) => {
          if (!response.ok) throw new Error(`the server answered ${response.status}`);
          return response.json();
        })
        .then((body) => (STATIC ? (body as Snapshot) : draw(body as DevState)))
        .then(
          (snapshot) => setState({ status: "ready", snapshot }),
          (error: Error) => setState({ status: "failed", message: error.message }),
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

  return state;
}
