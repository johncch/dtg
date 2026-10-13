import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Edit } from "../src/edit.js";
import type { Snapshot } from "../src/snapshot.js";

type Trying = {
  /** Draw the app as if `edit` had been made, or pass null to stop. Nothing is kept. */
  preview(edit: Edit | null): void;
  /** Make `edit` an unsaved change in the working copy. */
  commit(edit: Edit): void;
  /** Why the edit being tried cannot be drawn, or null when it can. */
  refusal: string | null;
};

const TryingContext = createContext<Trying>({ preview: () => {}, commit: () => {}, refusal: null });

export function useTrying(): Trying {
  return useContext(TryingContext);
}

/**
 * Holds the snapshot of the definition-with-an-edit-being-tried. The server
 * does the resolving, since the algorithms live there; a drag asks far faster
 * than it answers, so only the latest ask is ever sent and an answer that is
 * no longer the latest is dropped.
 *
 * Committing keeps the tried picture on screen until the working copy that
 * contains the edit arrives, so the page does not flash back to the old color
 * in between.
 */
export function TryingProvider({
  base,
  children,
}: {
  /** The working copy as the server last sent it. */
  base: Snapshot;
  children: (shown: Snapshot) => ReactNode;
}) {
  const [tried, setTried] = useState<Snapshot | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const wanted = useRef<Edit | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (wanted.current == null) setTried(null);
  }, [base]);

  const send = useCallback(() => {
    const edit = wanted.current;
    if (edit == null || inFlight.current) return;
    inFlight.current = true;
    fetch("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ edits: [edit] }),
    })
      .then(async (response): Promise<Snapshot | string> => {
        if (response.ok) return (await response.json()) as Snapshot;
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        return body.error ?? `the server answered ${response.status}`;
      })
      .catch((error: Error) => error.message)
      .then((answer) => {
        inFlight.current = false;
        if (wanted.current !== edit) {
          send();
        } else if (typeof answer === "string") {
          setRefusal(answer);
        } else {
          setTried(answer);
          setRefusal(null);
        }
      });
  }, []);

  const trying = useMemo<Trying>(
    () => ({
      preview(edit) {
        wanted.current = edit;
        if (edit == null) {
          setTried(null);
          setRefusal(null);
        } else send();
      },
      commit(edit) {
        wanted.current = null;
        setRefusal(null);
        fetch("/api/edits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ edit }),
        }).then(
          (response) => {
            if (!response.ok) setTried(null);
          },
          () => setTried(null),
        );
      },
      refusal,
    }),
    [send, refusal],
  );

  return <TryingContext.Provider value={trying}>{children(tried ?? base)}</TryingContext.Provider>;
}
