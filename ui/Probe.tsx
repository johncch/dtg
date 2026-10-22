import { useMemo, useState } from "react";
import type { Color, Gamut } from "../src/color-math.js";
import type { Selector } from "../src/contract.js";
import { formatRef, formatSelector } from "../src/selector.js";
import type { SnapshotSystem } from "../src/snapshot.js";
import { ColorFacts } from "./ColorTip.js";
import { probeOf } from "./engine.js";
import { carriedOver, StepControls } from "./RefEditor.js";

type Answer = { kind: "color"; color: Color } | { kind: "refused"; error: string };

/**
 * Any step the system can produce, looked at without a ref demanding it. The
 * definition is not touched: the probe is resolved beside the working copy
 * and nothing about it is kept.
 */
export function Probe({ system, definition, gamut }: { system: SnapshotSystem; definition: string; gamut: Gamut }) {
  const [selector, setSelector] = useState<Selector>(() => carriedOver(null, system.selector));
  const ref = formatRef(system.system, formatSelector(system.selector, selector));
  const answer = useProbe(ref, definition, gamut);

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

/** Resolved in the page each time the ref or the definition changes. */
function useProbe(ref: string, definition: string, gamut: Gamut): Answer {
  return useMemo(() => {
    const probe = probeOf(definition, gamut, ref);
    return "error" in probe ? { kind: "refused", error: probe.error } : { kind: "color", color: probe.color };
  }, [ref, definition, gamut]);
}
