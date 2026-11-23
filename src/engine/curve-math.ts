/** CSS cubic-bezier(x1, y1, x2, y2): x in 0–1, y free, so a curve can overshoot. */
export type Ease = [number, number, number, number];

/** A `curve` param's value: one channel running from `from`, through a pivot the algorithm supplies, to `to`. */
export type CurveValue = {
  from: number;
  to: number;
  /** Before the pivot, then after it. */
  easing: [Ease, Ease];
};

/** Where a curve passes through what its algorithm holds fixed: a position along it and the channel's value there. */
export type Pivot = { at: number; value: number };

/** The range a curve runs across: the selector field it runs along, from its min to its max. */
export type Span = { min: number; max: number };

/** A straight line, with its handles a third of the way along so an editor can grab them. */
export const LINEAR: Ease = [0.33, 0.33, 0.67, 0.67];

/** cubic-bezier at x: find the curve parameter whose x matches, return its y. */
export function cubicBezier([x1, y1, x2, y2]: Ease, x: number): number {
  const at = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s ** 2 * b + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

/** The curve's value at a position: `from` at the span's start, the pivot's value at its position, `to` at the span's end. */
export function curveAt(curve: CurveValue, pivot: Pivot, at: number, span: Span): number {
  if (at < pivot.at) {
    if (pivot.at === span.min) return pivot.value;
    return curve.from + (pivot.value - curve.from) * cubicBezier(curve.easing[0], (at - span.min) / (pivot.at - span.min));
  }
  if (pivot.at === span.max) return pivot.value;
  return pivot.value + (curve.to - pivot.value) * cubicBezier(curve.easing[1], (at - pivot.at) / (span.max - pivot.at));
}
