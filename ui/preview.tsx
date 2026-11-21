import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Edit } from "../src/edit.js";
import { previewOf, type Drawn } from "./engine.js";
import { openOnceThere, type Opening } from "./follow.js";
import { useStore } from "./store.js";

type Trying = {
  /** Draw the app as if `edit` had been made, or pass null to stop. Nothing is kept. */
  preview(edit: Edit | null): void;
  /** The same for several edits at once, as a drag that moves many colors makes. */
  previewStep(edits: Edit[] | null): void;
  /** Make `edit` an unsaved change in the working copy, and open `opening` once it is one. Returns why it was refused, or null when it was kept. */
  commit(edit: Edit, opening?: Opening): string | null;
  /** Make several edits unsaved changes as one step, which one undo takes back. Otherwise as `commit`. */
  commitStep(edits: Edit[], opening?: Opening): string | null;
  /** Why the edit being tried cannot be drawn, or null when it can. */
  refusal: string | null;
  /** Why the last step made was not kept: a refusal that was not merely tried. An editor that is open says its own. */
  stepRefusal: string | null;
};

const TryingContext = createContext<Trying>({ preview: () => {}, previewStep: () => {}, commit: () => null, commitStep: () => null, refusal: null, stepRefusal: null });

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
  const [stepRefused, setStepRefused] = useState(false);
  const wanted = useRef<Edit[] | null>(null);
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
      const edits = wanted.current;
      if (edits == null) return;
      try {
        setTried(previewOf(latestBase.current.snapshot, edits));
        setRefusal(null);
      } catch (e) {
        setRefusal((e as Error).message);
      }
      setStepRefused(false);
    });
  }, []);

  const trying = useMemo<Trying>(() => {
    const commitStep = (edits: Edit[], opening?: Opening) => {
      wanted.current = null;
      // A step that leaves the definition unresolvable is refused here,
      // whole, rather than kept as a change nobody can see.
      try {
        previewOf(latestBase.current.snapshot, edits);
      } catch (e) {
        setTried(null);
        setRefusal((e as Error).message);
        setStepRefused(true);
        return (e as Error).message;
      }
      setRefusal(null);
      setStepRefused(false);
      if (opening) openOnceThere(opening);
      store.commit(edits).catch(() => {
        setTried(null);
        if (opening) openOnceThere(null);
      });
      return null;
    };
    const previewStep = (edits: Edit[] | null) => {
      wanted.current = edits;
      if (edits == null) {
        setTried(null);
        setRefusal(null);
        setStepRefused(false);
      } else schedule();
    };
    return {
      preview: (edit) => previewStep(edit && [edit]),
      previewStep,
      commit: (edit, opening) => commitStep([edit], opening),
      commitStep,
      refusal,
      stepRefusal: stepRefused ? refusal : null,
    };
  }, [schedule, refusal, stepRefused, store]);

  return <TryingContext.Provider value={trying}>{children(tried ?? base)}</TryingContext.Provider>;
}

/** The first of a refusal's errors: the reason, before everything that fails because of it. */
export function firstError(refusal: string): string {
  const first = refusal.split("\n").find((line) => line.startsWith("- "));
  return first ? first.slice(2) : refusal;
}
