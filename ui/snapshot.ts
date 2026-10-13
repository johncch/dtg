import { useEffect, useState } from "react";
import type { Snapshot } from "../src/snapshot.js";

export type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; snapshot: Snapshot }
  | { status: "failed"; message: string };

export function useSnapshot(): SnapshotState {
  const [state, setState] = useState<SnapshotState>({ status: "loading" });

  useEffect(() => {
    const load = () => {
      fetch("/api/snapshot")
        .then((response) => {
          if (!response.ok) throw new Error(`the server answered ${response.status}`);
          return response.json() as Promise<Snapshot>;
        })
        .then(
          (snapshot) => setState({ status: "ready", snapshot }),
          (error: Error) => setState({ status: "failed", message: error.message }),
        );
    };
    load();

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
