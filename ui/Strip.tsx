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

export function Strip({ system, withDeltas = false }: { system: SnapshotSystem; withDeltas?: boolean }) {
  if (system.steps.length === 0) return <p className="sub">No steps demanded yet.</p>;
  return (
    <div className="strip-wrap">
      <div className="strip">
        {system.steps.map((step) => {
          const labelColor = labelColorOn(step.color);
          return (
            <ColorTip key={step.selector} color={step.color}>
              <Link
                to={{ page: "system", name: system.system }}
                hash={stepAnchor(step.publicStep)}
                className={isOpaque(step.color) ? undefined : "swatch-alpha"}
              >
                <span className="strip-fill" style={{ background: paintCss(step.color) }} />
                <span className="step-label" style={{ color: labelColor }}>
                  {step.publicStep}
                </span>
              </Link>
            </ColorTip>
          );
        })}
      </div>
      {withDeltas && (
        <div className="strip-gaps">
          {system.steps.map((step, index) => {
            const next = system.steps[index + 1];
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
