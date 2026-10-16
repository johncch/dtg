import type { CSSProperties } from "react";
import { formatColor, isOpaque, oklabDeltaE, type Color } from "../src/color-math.js";
import type { SnapshotSystem } from "../src/snapshot.js";
import { ColorTip } from "./ColorTip.js";
import { paintCss } from "./paint.js";
import { Link } from "./router.js";

export function stepAnchor(publicStep: string): string {
  return `s-${publicStep}`;
}

function luma(hex: string): number {
  return (
    0.299 * parseInt(hex.slice(1, 3), 16) +
    0.587 * parseInt(hex.slice(3, 5), 16) +
    0.114 * parseInt(hex.slice(5, 7), 16)
  );
}

export function labelColorOn(color: Color): string {
  return isOpaque(color) && luma(formatColor(color, "srgb")) < 150 ? "#fff" : "#1d2427";
}

/** ΔE between two steps, or null when either is translucent and has no single color to compare. */
export function stepDeltaE(a: Color, b: Color): string | null {
  if (!isOpaque(a) || !isOpaque(b)) return null;
  return oklabDeltaE(formatColor(a, "srgb"), formatColor(b, "srgb")).toFixed(3);
}

/**
 * A system's steps as swatches with their names underneath. Flattened steps
 * and translucent ones are different kinds of value, so each gets its own
 * row; ΔE between neighbors only means something on the flattened one.
 */
export function Strip({ system, withDeltas = false }: { system: SnapshotSystem; withDeltas?: boolean }) {
  if (system.steps.length === 0) return <p className="sub">No steps yet: nothing uses this system, and its <code>emit</code> lists none.</p>;
  const opaque = system.steps.filter((step) => isOpaque(step.color));
  const translucent = system.steps.filter((step) => !isOpaque(step.color));
  const captioned = opaque.length > 0 && translucent.length > 0;
  return (
    <>
      {opaque.length > 0 && (
        <StepRow system={system} steps={opaque} caption={captioned ? "flattened" : null} withDeltas={withDeltas} />
      )}
      {translucent.length > 0 && (
        <StepRow system={system} steps={translucent} caption={captioned ? "translucent" : null} withDeltas={false} baseline />
      )}
    </>
  );
}

function StepRow({
  system,
  steps,
  caption,
  withDeltas,
  baseline = false,
}: {
  system: SnapshotSystem;
  steps: SnapshotSystem["steps"];
  caption: string | null;
  withDeltas: boolean;
  /** A first cell with no color at all, so a translucent step has the bare ground and checker to be read against. */
  baseline?: boolean;
}) {
  return (
    <div className="strip-wrap" style={{ "--cells": steps.length + (baseline ? 1 : 0) } as CSSProperties}>
      {caption && <div className="strip-caption">{caption}</div>}
      <div className="strip">
        {baseline && <span className="strip-baseline swatch-alpha" aria-label="no tint" />}
        {steps.map((step) => (
          <ColorTip key={step.selector} color={step.color}>
            <Link
              to={{ page: "system", name: system.system }}
              hash={stepAnchor(step.publicStep)}
              className={isOpaque(step.color) ? undefined : "swatch-alpha"}
              aria-label={step.publicStep}
            >
              <span className="strip-fill" style={{ background: paintCss(step.color) }} />
            </Link>
          </ColorTip>
        ))}
      </div>
      <div className="strip-labels">
        {baseline && <span className="strip-baseline-label">none</span>}
        {steps.map((step) => (
          <span key={step.selector}>{step.publicStep}</span>
        ))}
      </div>
      {withDeltas && (
        <div className="strip-gaps">
          {steps.map((step, index) => {
            const next = steps[index + 1];
            const delta = next ? stepDeltaE(step.color, next.color) : null;
            return (
              <div className="gap" key={step.selector}>
                {delta && <span>{delta}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
