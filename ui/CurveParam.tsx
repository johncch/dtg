import { useEffect, useRef, useState, type PointerEvent } from "react";
import { curveAt, type CurveValue, type Ease } from "../src/curve-math.js";
import type { EditTarget } from "../src/edit.js";
import type { ResolvedCurve } from "../src/resolve.js";
import { STATIC } from "./mode.js";
import { paintCss } from "./paint.js";
import { Popup, type PopupPanel } from "./Popup.js";
import { useTrying } from "./preview.js";

type Range = { min: number; max: number };

/** A `curve` param as one chip: a small drawing of the curve; clicking it opens the curve to drag and its numbers to type. */
export function CurveParam({
  name,
  curve,
  target,
  defaulted,
}: {
  name: string;
  curve: ResolvedCurve;
  target: EditTarget;
  defaulted: boolean;
}) {
  const range = displayRange(curve);
  const label = (
    <span>
      <CurveDrawing curve={curve.value} drawn={curve} range={range} width={72} height={32} />
      {defaulted && (
        <>
          <br />
          <span className="muted">default</span>
        </>
      )}
    </span>
  );
  if (STATIC) return <span className="chip">{label}</span>;
  return (
    <Popup title={`Edit ${name}`} className="chip chip-editable curve-param" label={label} focus="panel">
      {(panel) => <CurveEditor name={name} original={curve} range={range} target={target} panel={panel} />}
    </Popup>
  );
}

/** Lightness and chroma draw across their whole bounds; hue, bounded at ±180, draws around what it uses. */
function displayRange(curve: ResolvedCurve): Range {
  if (curve.max - curve.min <= 2) return { min: curve.min, max: curve.max };
  const reach = Math.max(30, Math.abs(curve.value.from), Math.abs(curve.value.to), Math.abs(curve.pivot.value)) * 1.25;
  return { min: Math.max(curve.min, -reach), max: Math.min(curve.max, reach) };
}

const round = (n: number) => Number(n.toFixed(Math.abs(n) >= 10 ? 1 : 3));

function CurveEditor({
  name,
  original,
  range,
  target,
  panel,
}: {
  name: string;
  original: ResolvedCurve;
  range: Range;
  target: EditTarget;
  panel: PopupPanel;
}) {
  const { preview, commit, refusal } = useTrying();
  // While the edit is tried, the page shows it, so `original` follows it; what to compare against is the curve as the panel opened on it.
  const [opened] = useState<CurveValue>(original.value);
  const [value, setValue] = useState<CurveValue>(original.value);
  const changed = JSON.stringify(value) !== JSON.stringify(opened);
  // Written as the file would be by hand: an easing left at the default stays unwritten.
  const written =
    JSON.stringify(value.easing) === JSON.stringify(original.default.easing) ? { from: value.from, to: value.to } : value;
  const edit = changed ? { action: "set" as const, target, value: JSON.stringify(written) } : null;
  const latest = useRef(edit);
  latest.current = edit;
  useEffect(() => preview(edit), [JSON.stringify(value)]);
  useEffect(
    () => () => {
      if (latest.current) commit(latest.current);
      else preview(null);
    },
    [],
  );

  const setEase = (side: 0 | 1, index: number, n: number) => {
    const easing = value.easing.map((ease) => [...ease]) as [Ease, Ease];
    easing[side][index] = n;
    setValue({ ...value, easing });
  };

  return (
    <form
      className="ref-editor curve-editor"
      onSubmit={(event) => {
        event.preventDefault();
        panel.dismiss();
      }}
    >
      <div className="editor-head" {...panel.handle}>
        <span className="ref-editor-heading">{name}</span>
        {panel.close}
      </div>
      {original.label && <p className="curve-label">{original.label}</p>}
      <CurveDrawing curve={value} drawn={original} range={range} width={300} height={198} bounds={original} onChange={setValue} />
      <div className="curve-fields">
        <label>
          from
          <NumberField label={`${name} from`} value={value.from} onChange={(from) => setValue({ ...value, from })} />
        </label>
        <label>
          to
          <NumberField label={`${name} to`} value={value.to} onChange={(to) => setValue({ ...value, to })} />
        </label>
      </div>
      {(["before the anchor", "after the anchor"] as const).map((side, s) => (
        <div className="curve-easing" key={side}>
          <span className="muted">easing {side}</span>
          <div className="curve-easing-fields">
            {value.easing[s].map((n, i) => (
              <NumberField
                key={i}
                label={`easing ${side}, ${["x1", "y1", "x2", "y2"][i]}`}
                value={n}
                onChange={(next) => setEase(s as 0 | 1, i, next)}
              />
            ))}
          </div>
        </div>
      ))}
      {edit && refusal && <p className="ref-error">{firstError(refusal)}</p>}
      {/* A form of several fields submits on Enter only when it has a submit button. */}
      <button type="submit" hidden />
    </form>
  );
}

/**
 * A number typed in place: every keystroke that reads as a number reaches the
 * curve at once, so Enter, which closes the panel, never outruns it. A drag
 * moving the number shows here unless the field is being typed in.
 */
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(String(value));
  }, [value]);
  return (
    <input
      className="ref-input"
      type="number"
      step="any"
      aria-label={label}
      value={text}
      onFocus={() => (typing.current = true)}
      onBlur={() => {
        typing.current = false;
        setText(String(value));
      }}
      onChange={(event) => {
        setText(event.target.value);
        const n = Number(event.target.value);
        if (event.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function firstError(refusal: string): string {
  const first = refusal.split("\n").find((line) => line.startsWith("- "));
  return first ? first.slice(2) : refusal;
}

const PAD = 10;

/** Which point a drag holds: an end, or one of the four easing handles. */
type Grip = "from" | "to" | { side: 0 | 1; handle: 0 | 1 };

function CurveDrawing({
  curve,
  drawn,
  range,
  width,
  height,
  bounds,
  onChange,
}: {
  curve: CurveValue;
  /** What the resolver says about the curve: its pivot and span, the colors along it, and what its values look like. */
  drawn: Pick<ResolvedCurve, "pivot" | "span" | "samples" | "marks" | "swatches" | "unit">;
  range: Range;
  width: number;
  height: number;
  /** The param's own bounds, which a dragged end is held inside; absent for a drawing that does not edit. */
  bounds?: Range;
  onChange?: (next: CurveValue) => void;
}) {
  const { pivot, span, samples, marks, swatches, unit } = drawn;
  const grip = useRef<Grip | null>(null);
  const large = onChange != null;
  const pad = large ? PAD : 3;
  const strip = samples.length > 0 ? (large ? 10 : 4) : 0;
  const positions = large ? 12 : 0;
  const bar = large && swatches.length > 0 ? 10 : 0;
  const plotLeft = pad + (bar > 0 ? bar + 6 : 0);
  const stripTop = height - pad - positions - strip;
  const plotBottom = stripTop - (strip > 0 ? (large ? 6 : 2) : 0);
  const x = (at: number) => plotLeft + ((at - span.min) / (span.max - span.min)) * (width - plotLeft - pad);
  const y = (value: number) => plotBottom - ((value - range.min) / (range.max - range.min)) * (plotBottom - pad);
  const valueAt = (at: number) => curveAt(curve, pivot, at, span);
  const path = Array.from({ length: 101 }, (_, i) => {
    const at = span.min + (i / 100) * (span.max - span.min);
    return `${i === 0 ? "M" : "L"}${x(at).toFixed(1)} ${y(valueAt(at)).toFixed(1)}`;
  }).join(" ");
  const segments = [
    { from: [span.min, curve.from], to: [pivot.at, pivot.value] },
    { from: [pivot.at, pivot.value], to: [span.max, curve.to] },
  ] as const;
  const handles = segments.flatMap((segment, side) =>
    [0, 1].map((handle) => {
      const ease = curve.easing[side];
      return {
        side: side as 0 | 1,
        handle: handle as 0 | 1,
        at: segment.from[0] + ease[handle * 2] * (segment.to[0] - segment.from[0]),
        value: segment.from[1] + ease[handle * 2 + 1] * (segment.to[1] - segment.from[1]),
        end: handle === 0 ? segment.from : segment.to,
      };
    }),
  );

  function move(event: PointerEvent<SVGSVGElement>) {
    const held = grip.current;
    if (!held || !onChange || !bounds) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const py = ((event.clientY - box.top) / box.height) * height;
    const at = Math.min(span.max, Math.max(span.min, span.min + ((px - plotLeft) / (width - plotLeft - pad)) * (span.max - span.min)));
    const value = range.min + ((plotBottom - py) / (plotBottom - pad)) * (range.max - range.min);
    if (held === "from" || held === "to") {
      onChange({ ...curve, [held]: round(Math.min(bounds.max, Math.max(bounds.min, value))) });
      return;
    }
    const segment = segments[held.side];
    const easing = curve.easing.map((ease) => [...ease]) as [Ease, Ease];
    easing[held.side][held.handle * 2] = Number(Math.min(1, Math.max(0, (at - segment.from[0]) / (segment.to[0] - segment.from[0]))).toFixed(2));
    if (segment.to[1] !== segment.from[1]) {
      const share = (value - segment.from[1]) / (segment.to[1] - segment.from[1]);
      easing[held.side][held.handle * 2 + 1] = Number(Math.min(3, Math.max(-2, share)).toFixed(2));
    }
    onChange({ ...curve, easing });
  }

  const start = (point: Grip) => (event: PointerEvent<SVGCircleElement>) => {
    if (!onChange) return;
    grip.current = point;
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
  };
  const release = () => {
    grip.current = null;
  };

  return (
    <svg
      className={large ? "curve-drawing curve-drawing-large" : "curve-drawing"}
      viewBox={`0 0 ${width} ${height}`}
      width={large ? undefined : width}
      height={large ? undefined : height}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {bar > 0 && <Bands swatches={swatches} range={range} y={y} left={pad} right={pad + bar} top={pad} bottom={plotBottom} />}
      {large && <rect x={plotLeft} y={pad} width={width - plotLeft - pad} height={plotBottom - pad} className="curve-frame" />}
      {large &&
        [range.max, ...(range.min < 0 && range.max > 0 ? [0] : []), range.min].map((value) => (
          <text key={value} x={plotLeft + 3} y={y(value) + (value === range.max ? 10 : value === range.min ? -3 : -2)} className="curve-axis-label">
            {tickText(value, unit)}
          </text>
        ))}
      {large && range.min < 0 && <line x1={plotLeft} x2={width - pad} y1={y(0)} y2={y(0)} className="curve-zero" />}
      {samples.map((sample, i) => {
        const left = i === 0 ? x(span.min) : (x(samples[i - 1].at) + x(sample.at)) / 2;
        const right = i === samples.length - 1 ? x(span.max) : (x(sample.at) + x(samples[i + 1].at)) / 2;
        return <rect key={i} x={left} y={stripTop} width={right - left + 0.5} height={strip} style={{ fill: paintCss(sample.color) }} />;
      })}
      {large &&
        [span.min, pivot.at, span.max].map((at, i) => (
          <text key={i} x={x(at)} y={height - pad + 1} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className="curve-axis-label">
            {round(at)}
          </text>
        ))}
      {large &&
        handles.map((h) => (
          <line key={`arm${h.side}${h.handle}`} x1={x(h.end[0])} y1={y(h.end[1])} x2={x(h.at)} y2={y(h.value)} className="curve-arm" />
        ))}
      <path d={path} className="curve-line" />
      {large &&
        marks.map((mark) => (
          <circle key={mark.step} cx={x(mark.at)} cy={y(valueAt(mark.at))} r={4} className="curve-mark" style={{ fill: paintCss(mark.color) }}>
            <title>{mark.step}</title>
          </circle>
        ))}
      {large &&
        handles.map((h) => (
          <circle key={`h${h.side}${h.handle}`} cx={x(h.at)} cy={y(h.value)} r={5} className="curve-handle" onPointerDown={start({ side: h.side, handle: h.handle })} />
        ))}
      {large && <circle cx={x(span.min)} cy={y(curve.from)} r={6} className="curve-end" onPointerDown={start("from")} />}
      {large && <circle cx={x(span.max)} cy={y(curve.to)} r={6} className="curve-end" onPointerDown={start("to")} />}
      {large ? (
        <circle cx={x(pivot.at)} cy={y(pivot.value)} r={7.5} className="curve-anchor-ring" />
      ) : (
        <circle cx={x(pivot.at)} cy={y(pivot.value)} r={2.5} className="curve-anchor" />
      )}
    </svg>
  );
}

function tickText(value: number, unit: string | null): string {
  const shown = round(value);
  return unit ? `${shown > 0 ? "+" : ""}${shown}${unit}` : String(shown);
}

/** What the curve's values look like, as a bar beside the y-axis: each swatch fills the height its value covers. */
function Bands({
  swatches,
  range,
  y,
  left,
  right,
  top,
  bottom,
}: {
  swatches: ResolvedCurve["swatches"];
  range: Range;
  y: (value: number) => number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}) {
  const shown = swatches.filter((swatch) => swatch.value >= range.min - 1e-9 && swatch.value <= range.max + 1e-9);
  return (
    <g className="curve-bands">
      {shown.map((swatch, i) => {
        const upper = i === shown.length - 1 ? top : Math.max(top, (y(swatch.value) + y(shown[i + 1].value)) / 2);
        const lower = i === 0 ? bottom : Math.min(bottom, (y(swatch.value) + y(shown[i - 1].value)) / 2);
        return <rect key={i} x={left} y={upper} width={right - left} height={Math.max(0, lower - upper) + 0.5} style={{ fill: paintCss(swatch.color) }} />;
      })}
    </g>
  );
}
