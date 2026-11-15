import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { colorFromOklab, formatColor, hueOf, oklabToOklch, oklchToOklab, toOklab, type Color, type Oklch } from "../src/color-math.js";
import { EDITABLE } from "./mode.js";
import { paintCss } from "./paint.js";
import { LockIcon } from "./LockIcon.js";
import { labelColorOn } from "./Strip.js";

export type PaletteEntry = { name: string; path: string; written: string; color: Color };

type Props = {
  entries: PaletteEntry[];
  active: string | null;
  chromaMax: number;
  hovered: string | null;
  onHover: (path: string | null) => void;
  onSelect: (path: string | null) => void;
  /** `withOthers` asks that the other colors turn with this one, whatever the caller's own setting. */
  onChange: (channels: Oklch, path: string, withOthers: boolean) => void;
  onFinish: () => void;
  onCancel: () => void;
  onAdd: (channels: Oklch) => void;
  isLocked: (path: string) => boolean;
  /** Hues to draw arms at, from the center of the hue disk. */
  guides: number[];
  /** Drawn beside the view controls. */
  tools?: ReactNode;
};

type View = "hc" | "hcl";
type Point = { x: number; y: number };
const VIEWS: { value: View; label: string }[] = [
  { value: "hc", label: "Hue + Chroma" },
  { value: "hcl", label: "Lightness" },
];
const HUES = Array.from({ length: 12 }, (_, index) => index * 30);
const RADIANS = Math.PI / 180;
const wrap = (hue: number) => (hue % 360 + 360) % 360;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function median(values: number[], fallback: number) {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function PalettePlots(props: Props) {
  const [view, setView] = useState<View>("hc");
  return (
    <div className="palette-plots">
      <div className="palette-plot-controls">
        <div className="palette-view-controls" role="group" aria-label="Palette view">
          {VIEWS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className="palette-view-mode palette-visual-control"
              aria-pressed={view === value}
              onClick={() => { props.onFinish(); props.onHover(null); setView(value); }}
            >
              {label}
            </button>
          ))}
        </div>
        {props.tools}
      </div>
      <div className="palette-circular-views">
        <CircularPlot {...props} view={view} />
      </div>
    </div>
  );
}

function CircularPlot({ entries, active, chromaMax, hovered, onHover, onSelect, onChange, onFinish, onCancel, onAdd, isLocked, guides, view }: Props & { view: View }) {
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const dragging = useRef<{ path: string; channels: Oklch; x: number; y: number; moved: boolean } | null>(null);
  const emptyClickBase = useRef<Oklch | null>(null);
  const is3D = view === "hcl";
  const [orientation, setOrientation] = useState(0);
  const currentOrientation = useRef(0);
  const transitioning = Math.abs(orientation - (is3D ? 1 : 0)) > 0.0001;
  const height = 360 + 40 * orientation;
  const flatRadius = Math.max(36, Math.min((width - 16) / 2, 170));
  // The lightness scale is written on the left, so that view keeps its margin there and gives up the one on the right.
  const raisedRadius = Math.max(36, Math.min((width - 64) / 2, 190));
  const radius = flatRadius + (raisedRadius - flatRadius) * orientation;
  const cx = width / 2 + (Math.max(width / 2, 56 + raisedRadius) - width / 2) * orientation;
  // The lightness view looks at the disk edge on, so height is lightness and nothing else.
  const tilt = 1 - orientation;
  const depth = radius * tilt;
  const cy = 180 + (400 - 42 - 180) * orientation;
  const lift = (400 - 84 - 16) * orientation;
  const points = entries.map((entry) => ({ ...entry, channels: oklabToOklch(toOklab(entry.color)), hue: hueOf(entry.color) }));
  const min = Math.min(0, ...points.map((point) => Math.floor(point.channels[0] * 10) / 10));
  const max = Math.max(1, ...points.map((point) => Math.ceil(point.channels[0] * 10) / 10));
  const level = (channels: Oklch) => (channels[0] - min) / (max - min);
  const at = (hue: number | null, chroma: number, value = 0): Point => ({
    x: cx + (hue == null ? 0 : radius * chroma / chromaMax * Math.sin(hue * RADIANS)),
    y: cy - lift * value - (hue == null ? 0 : depth * chroma / chromaMax * Math.cos(hue * RADIANS)),
  });
  const positioned = points.map((point) => ({ ...point, ...at(point.hue, point.channels[1], level(point.channels)) }));
  const selected = positioned.find((point) => point.path === active);
  const newColorBase: Oklch = selected?.channels ?? [
    median(points.map((point) => point.channels[0]), 0.65),
    median(points.filter((point) => point.hue != null).map((point) => point.channels[1]), 0.15),
    0,
  ];
  const overlaps: typeof positioned[] = [];
  for (const point of positioned) {
    const group = overlaps.find((group) => group.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < 22));
    if (group) group.push(point);
    else overlaps.push([point]);
  }
  const arc = (value: number, from: number, to: number, chroma = chromaMax) => {
    const count = Math.max(2, Math.ceil(Math.abs(to - from) / 4));
    return Array.from({ length: count + 1 }, (_, index) => {
      const point = at(from + (to - from) * index / count, chroma, value);
      return `${index ? "L" : "M"}${point.x},${point.y}`;
    }).join(" ");
  };
  const disk = useMemo(() => Array.from({ length: 120 }, (_, sector) =>
    Array.from({ length: 20 }, (_, band) => {
      const from = sector * 3;
      const to = from + 3.08;
      const inner = band / 20;
      const outer = (band + 1) / 20 + 0.001;
      const xy = (angle: number, distance: number) => `${Math.sin(angle * RADIANS) * distance},${-Math.cos(angle * RADIANS) * distance}`;
      return {
        path: `M${xy(from, inner)} L${xy(from, outer)} A${outer},${outer} 0 0 1 ${xy(to, outer)} L${xy(to, inner)} ${inner ? `A${inner},${inner} 0 0 0 ${xy(from, inner)}` : ""} Z`,
        color: formatColor(colorFromOklab(oklchToOklab([0.72, (band + 0.5) / 20 * chromaMax, from + 1.5])), "srgb"),
      };
    })).flat(), [chromaMax]);
  // One picture, not 2,400 paths: Safari repaints every path under the plot whenever a dot moves.
  const diskImage = useMemo(() => {
    const size = 720;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.translate(size / 2, size / 2);
    context.scale(size / 2, size / 2);
    context.lineWidth = 0.004;
    for (const tile of disk) {
      const shape = new Path2D(tile.path);
      context.fillStyle = context.strokeStyle = tile.color;
      context.fill(shape);
      context.stroke(shape);
    }
    return canvas.toDataURL();
  }, [disk]);

  useEffect(() => {
    dragging.current = null;
    emptyClickBase.current = null;
    const target = is3D ? 1 : 0;
    const from = currentOrientation.current;
    if (from === target) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const update = (value: number) => {
      currentOrientation.current = value;
      setOrientation(value);
    };
    const finishIfReduced = () => {
      if (!motion.matches) return;
      cancelAnimationFrame(frame);
      update(target);
    };
    if (motion.matches) {
      update(target);
      return;
    }
    const started = performance.now();
    const duration = 650 * Math.abs(target - from);
    const animate = (now: number) => {
      const elapsed = Math.min(1, (now - started) / duration);
      const eased = elapsed < 0.5 ? 4 * elapsed ** 3 : 1 - (-2 * elapsed + 2) ** 3 / 2;
      update(from + (target - from) * eased);
      if (elapsed < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    motion.addEventListener("change", finishIfReduced);
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", finishIfReduced);
    };
  }, [is3D]);

  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const held = dragging.current;
    if (!held || isLocked(held.path)) return;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    if (!held.moved && Math.hypot(dx, dy) < 3) return;
    held.moved = true;
    const next = [...held.channels] as Oklch;
    if (is3D) {
      next[0] = clamp(held.channels[0] - dy / lift * (max - min), min, max);
    } else {
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left - cx;
      const y = event.clientY - bounds.top - cy;
      const distance = Math.hypot(x, y);
      next[1] = distance < 3 ? 0 : clamp(distance / radius * chromaMax, 0, chromaMax);
      if (distance >= 3) next[2] = wrap(Math.atan2(x, -y) / RADIANS);
    }
    onChange(next, held.path, event.shiftKey);
  };

  const colorAt = (x: number, y: number, base: Oklch): Oklch | null => {
    const next = [...base] as Oklch;
    const dx = x - cx;
    const dy = (y - cy) / tilt;
    const distance = Math.hypot(dx, dy);
    if (distance > radius) return null;
    next[1] = distance < 3 ? 0 : distance / radius * chromaMax;
    next[2] = distance >= 3 ? wrap(Math.atan2(dx, -dy) / RADIANS) : base[2];
    return next;
  };

  return (
    <section className="palette-plot-panel palette-circular-panel" aria-label={is3D ? "Lightness, seen from the side of the hue and chroma disk" : "Hue and chroma disk"}>
      <div
        className="palette-color-plot palette-circular-plot"
        ref={plot}
        style={{ height }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && dragging.current) {
            event.stopPropagation();
            dragging.current = null;
            onCancel();
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const marker = (event.target as Element).closest<HTMLButtonElement>(".palette-plot-dot");
          const point = points.find((point) => point.path === marker?.dataset.path);
          if (!point) return;
          emptyClickBase.current = null;
          if (!EDITABLE || transitioning) return;
          marker!.setPointerCapture(event.pointerId);
          if (isLocked(point.path)) return;
          dragging.current = { path: point.path, channels: point.channels, x: event.clientX, y: event.clientY, moved: false };
        }}
        onClick={(event) => {
          if ((event.target as Element).closest("button, text")) return;
          if (event.detail === 1) emptyClickBase.current = newColorBase;
        }}
        onDoubleClick={(event) => {
          if (!EDITABLE || is3D || transitioning || !emptyClickBase.current || (event.target as Element).closest("button, text")) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const next = colorAt(event.clientX - bounds.left, event.clientY - bounds.top, emptyClickBase.current);
          if (!next) return;
          event.preventDefault();
          emptyClickBase.current = null;
          onAdd(next);
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = null;
          onFinish();
          const marker = (event.target as Element).closest<HTMLButtonElement>(".palette-plot-dot");
          if (marker?.hasPointerCapture(event.pointerId)) marker.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { dragging.current = null; onCancel(); }}
      >
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="palette-plot-grid palette-circular-grid" aria-hidden="true">
          <g transform={`translate(${cx} ${cy}) scale(${radius} ${depth})`} className="palette-reference-disk">
            {diskImage && <image href={diskImage} x={-1} y={-1} width={2} height={2} preserveAspectRatio="none" />}
          </g>
          {[0.25, 0.5, 0.75, 1].map((share) => <path key={share} d={arc(0, 0, 360, chromaMax * share)} className="palette-disk-ring" />)}
          {HUES.map((hue) => {
            const outer = at(hue, chromaMax);
            return <line key={hue} x1={cx} y1={cy} x2={outer.x} y2={outer.y} className="palette-disk-spoke" />;
          })}
          <g opacity={1 - orientation} visibility={orientation === 1 ? "hidden" : undefined}>
            {[0.5, 1].map((share) => <text key={share} x={cx + radius * share - (share === 1 ? 6 : 0)} y={cy + 17} textAnchor={share === 1 ? "end" : "middle"} className="palette-chroma-label">{(chromaMax * share).toFixed(3)}</text>)}
          </g>
          <g opacity={orientation} visibility={orientation === 0 ? "hidden" : undefined}>
            <path d={arc(1, 0, 360)} className="palette-cylinder-rim" />
            <path d={`M${cx - radius},${cy} H${cx + radius}`} />
            {[0.25, 0.5, 0.75].map((value) => <g key={value}>
              <path d={arc(value, -90, 90)} className="palette-cylinder-back" />
              <path d={arc(value, 90, 270)} />
            </g>)}
            {[0, 90, 180, 270].map((hue) => {
              const bottom = at(hue, chromaMax);
              const top = at(hue, chromaMax, 1);
              return <line key={hue} x1={bottom.x} y1={bottom.y} x2={top.x} y2={top.y} className="palette-cylinder-back" />;
            })}
            <line x1={cx} y1={cy} x2={cx} y2={cy - lift} className="palette-neutral-guide" />
            {[0, 0.25, 0.5, 0.75, 1].map((value) => <g key={value}>
              <line x1={cx - radius - 17} x2={cx - radius - 9} y1={cy - lift * value} y2={cy - lift * value} />
              <text x={cx - radius - 23} y={cy - lift * value + 4} textAnchor="end">{(min + value * (max - min)).toFixed(2)}</text>
            </g>)}
            {positioned.map((point) => {
              const base = at(point.hue, point.channels[1]);
              const emphasized = point.path === (hovered ?? active);
              return <g key={point.path} className={emphasized ? "palette-color-stem is-emphasized" : "palette-color-stem"}>
                <line x1={base.x} y1={base.y} x2={point.x} y2={point.y} />
                <circle cx={base.x} cy={base.y} r={emphasized ? 4 : 3} />
              </g>;
            })}
          </g>
          <g opacity={1 - orientation} visibility={orientation === 1 ? "hidden" : undefined}>
            {guides.map((hue) => {
              const end = at(hue, chromaMax);
              return <line key={hue} x1={cx} y1={cy} x2={end.x} y2={end.y} className="palette-harmony-arm" />;
            })}
          </g>
          {selected && <line x1={cx} y1={cy} x2={at(selected.hue, selected.channels[1]).x} y2={at(selected.hue, selected.channels[1]).y} className="palette-plot-selection-guide" />}

        </svg>
        {[...positioned].sort((a, b) => Math.cos((b.hue ?? 0) * RADIANS) - Math.cos((a.hue ?? 0) * RADIANS)).map((point) => {
          const locked = EDITABLE && isLocked(point.path);
          const showName = point.path === hovered;
          return (
            <button
              type="button"
              key={point.path}
              data-path={point.path}
              className={`palette-plot-dot${locked ? " is-locked" : EDITABLE ? " is-draggable" : ""}${point.path === active ? " is-active" : ""}${hovered === point.path ? " is-hovered" : ""}${showName ? " is-labeled" : ""}${point.x > cx ? " label-left" : ""}${point.y > height - 65 ? " label-above" : ""}`}
              style={{ left: point.x, top: point.y }}
              aria-label={point.name}
              aria-description={`${point.hue == null ? "no hue" : `hue ${point.hue.toFixed(1)} degrees`}, lightness ${point.channels[0].toFixed(3)}, chroma ${point.channels[1].toFixed(3)}${locked ? "; locked, unlock to drag" : ""}`}
              aria-pressed={point.path === active}
              // A click or a drag adjusts the color; choosing it as the base takes a double click, or the keyboard, whose click has no count.
              onClick={(event) => { if (event.detail === 0) onSelect(point.path); }}
              onDoubleClick={() => onSelect(point.path)}
              onPointerEnter={() => onHover(point.path)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(point.path)}
              onBlur={() => onHover(null)}
            >
              <span className="palette-plot-dot-color" style={{ background: paintCss(point.color) }} />
              {locked && <span className="palette-plot-lock" style={{ color: labelColorOn(point.color) }}><LockIcon locked /></span>}
              {showName && <span className="palette-plot-dot-name">{point.name}</span>}
            </button>
          );
        })}
        {!transitioning && overlaps.filter((group) => group.length > 1).map((group) => <button
          key={group[0].path}
          type="button"
          className="palette-plot-overlap palette-visual-control"
          style={{ left: group[0].x + 16, top: group[0].y - 20 }}
          aria-label={`Cycle ${group.length} overlapping colors: ${group.map((point) => point.name).join(", ")}`}
          onClick={() => { const index = group.findIndex((point) => point.path === active); onSelect(group[(index + 1) % group.length].path); }}
        >{group.length}</button>)}
      </div>
    </section>
  );
}
