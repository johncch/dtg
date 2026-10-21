import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Edit } from "../src/edit.js";
import { previewOf, type Drawn } from "./engine.js";
import { useStore } from "./store.js";

type Trying = {
  /** Draw the app as if `edit` had been made, or pass null to stop. Nothing is kept. */
  preview(edit: Edit | null): void;
  /** Make `edit` an unsaved change in the working copy. */
  commit(edit: Edit): void;
  /** Make several edits unsaved changes as one step, which one undo takes back. */
  commitStep(edits: Edit[]): void;
  /** Why the edit being tried cannot be drawn, or null when it can. */
  refusal: string | null;
};

const TryingContext = createContext<Trying>({ preview: () => {}, commit: () => {}, commitStep: () => {}, refusal: null });

export function useTrying(): Trying {
  return useContext(TryingContext);
}

/**
 * Holds the snapshot of the definition-with-an-edit-being-tried, resolved in
 * the page. A drag asks far more often than the screen redraws, so asks
 * within one frame collapse into the latest.
 *
 * Committing keeps the tried picture on screen until the working copy that
 * contains the edit arrives, so the page does not flash back to the old color
 * in between.
 */
export function TryingProvider({
  base,
  children,
}: {
  /** The working copy, drawn. */
  base: Drawn;
  children: (shown: Drawn) => ReactNode;
}) {
  const store = useStore();
  const [tried, setTried] = useState<Drawn | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const wanted = useRef<Edit | null>(null);
  const frame = useRef<number | null>(null);
  const latestBase = useRef(base);

  useEffect(() => {
    latestBase.current = base;
    if (wanted.current == null) setTried(null);
  }, [base]);

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  const schedule = useCallback(() => {
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const edit = wanted.current;
      if (edit == null) return;
      try {
        setTried(previewOf(latestBase.current.snapshot, [edit]));
        setRefusal(null);
      } catch (e) {
        setRefusal((e as Error).message);
      }
    });
  }, []);

  const trying = useMemo<Trying>(() => {
    const commitStep = (edits: Edit[]) => {
      wanted.current = null;
      // A step that leaves the definition unresolvable is refused here,
      // whole, rather than kept as a change nobody can see.
      try {
        previewOf(latestBase.current.snapshot, edits);
      } catch (e) {
        setTried(null);
        setRefusal((e as Error).message);
        return;
      }
      setRefusal(null);
      store.commit(edits).catch(() => setTried(null));
    };
    return {
      preview(edit) {
        wanted.current = edit;
        if (edit == null) {
          setTried(null);
          setRefusal(null);
        } else schedule();
      },
      commit: (edit) => commitStep([edit]),
      commitStep,
      refusal,
    };
  }, [schedule, refusal, store]);

  return <TryingContext.Provider value={trying}>{children(tried ?? base)}</TryingContext.Provider>;
}
