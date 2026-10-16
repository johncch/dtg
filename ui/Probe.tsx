import { useEffect, useRef, useState } from "react";
import type { Color } from "../src/color-math.js";
import type { Selector } from "../src/contract.js";
import { formatRef, formatSelector } from "../src/selector.js";
import type { SnapshotSystem } from "../src/snapshot.js";
import { ColorFacts } from "./ColorTip.js";
import { carriedOver, StepControls } from "./RefEditor.js";

type Answer = { kind: "waiting" } | { kind: "color"; color: Color } | { kind: "refused"; error: string };

/**
 * Any step the system can produce, looked at without a ref demanding it. The
 * definition is not touched: the server resolves the probe beside the
 * working copy and nothing about it is kept.
 */
export function Probe({ system }: { system: SnapshotSystem }) {
  const [selector, setSelector] = useState<Selector>(() => carriedOver(null, system.selector));
  const ref = formatRef(system.system, formatSelector(system.selector, selector));
  const answer = useProbe(ref, system);

  return (
    <section className="box">
      <h2 className="box-title">Preview</h2>
      <div className="probe-body">
        <div className="probe-preview">
          {answer.kind === "color" && <ColorFacts color={answer.color} reference={<code>{ref}</code>} />}
        </div>
        <div className="probe-controls">
          <StepControls step={{ kind: "step", system, selector }} onChange={(next) => setSelector(next.selector)} />
          {answer.kind === "refused" && <p className="ref-error">{answer.error}</p>}
        </div>
      </div>
    </section>
  );
}

/**
 * The color `ref` comes to. A drag asks far faster than the server answers,
 * so only the latest ask is sent, and the last answer stays up meanwhile.
 */
function useProbe(ref: string, system: SnapshotSystem): Answer {
  const [answer, setAnswer] = useState<Answer>({ kind: "waiting" });
  const wanted = useRef(ref);
  const inFlight = useRef(false);

  const send = () => {
    if (inFlight.current) return;
    const asked = wanted.current;
    inFlight.current = true;
    fetch("/api/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: asked }),
    })
      .then(async (response): Promise<Answer> => {
        const body = (await response.json().catch(() => ({}))) as {
          color?: Color;
          error?: string;
        };
        if (response.ok && body.color) return { kind: "color", color: body.color };
        return {
          kind: "refused",
          error: body.error ?? `the server answered ${response.status}`,
        };
      })
      .catch((error: Error): Answer => ({
        kind: "refused",
        error: error.message,
      }))
      .then((next) => {
        inFlight.current = false;
        if (wanted.current !== asked) send();
        else setAnswer(next);
      });
  };

  // `system` changes identity whenever the working copy does, and an edited
  // param moves the probed color with it.
  useEffect(() => {
    wanted.current = ref;
    send();
  }, [ref, system]);

  return answer;
}
