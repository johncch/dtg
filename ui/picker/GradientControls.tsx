import { ChevronDown, Plus } from "lucide-react";
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { parseColor, type Color } from "../../src/engine/color-math.js";
import { gradientCss, stopPositions } from "../../src/engine/emit.js";
import { readGradient, writeGradient, type WrittenGradient } from "../../src/engine/ref-functions.js";
import { GEOMETRY_ARGUMENTS, RADIAL_SHAPES, RADIAL_SIZES, type GradientGeometry, type ResolvedGradientRef } from "../../src/engine/resolve.js";
import type { SnapshotConstant, SnapshotSystem } from "../../src/engine/snapshot.js";
import { isGradient, paintCss, paintIsOpaque } from "../paint.js";
import { Popup, type PopupPanel } from "../Popup.js";
import { TrashIcon } from "../TrashIcon.js";
import { ChoiceGrid, ValueEditor, type Choice, type Source } from "./ValueEditor.js";

const KINDS: GradientGeometry["kind"][] = ["linear", "radial", "conic"];
/** A ruler handle's width in pixels, as `--handle` has it in the stylesheet. */
const HANDLE = 16;

/**
 * A gradient's controls: how it is laid out, and its stops, each opening the
 * same editor any color is chosen in. Every control rewrites the one text
 * the gradient is. Text that does not read as a gradient is shown to be typed right.
 */
export function GradientControls({
  text,
  drawn,
  stopSources,
  constants,
  systems,
  roles,
  gradients,
  onChange,
}: {
  /** The gradient as written now. */
  text: string;
  /** What that text comes to as the app draws it now; null while it does not read. */
  drawn: ResolvedGradientRef | null;
  /** Where a stop's color can be chosen from. */
  stopSources: Source[];
  constants: SnapshotConstant[];
  systems: SnapshotSystem[];
  roles: Choice[];
  /** The gradients this one could restyle: the palette's, and the roles that are one. With none, there is only the one way to make it. */
  gradients: Choice[];
  /** `continuing` says this is the same change still under way, such as a drag, and not a new step. */
  onChange: (text: string, continuing?: boolean) => void;
}) {
  // Looking through the gradients to restyle changes nothing until one is chosen.
  const [choosing, setChoosing] = useState(false);
  const written = readGradient(text);
  const field = (
    <textarea
      className="ref-text"
      aria-label="Gradient"
      rows={6}
      spellCheck={false}
      value={text}
      onChange={(event) => onChange(event.target.value.replace(/\s+/g, " "))}
    />
  );
  if (!written) {
    return (
      <label className="ref-control ref-control-text">
        <span>
          colors, each with an optional position, then named arguments: <code>gradient(paper 0% sky(500) 100% angle=90deg)</code>
        </span>
        {field}
      </label>
    );
  }

  // One ref where the stops would be is a gradient being restyled.
  const restyles = written.stops.length === 1;
  const change = (next: Partial<WrittenGradient>, continuing = false) => onChange(writeGradient({ ...written, ...next }), continuing);
  const kind = (KINDS as string[]).includes(written.named.get("kind") ?? "") ? (written.named.get("kind") as GradientGeometry["kind"]) : (drawn?.geometry.kind ?? "linear");
  const setNamed = (name: string, value: string | null) => {
    const named = new Map(written.named);
    if (value == null) named.delete(name);
    else named.set(name, value);
    change({ named });
  };
  const setKind = (next: GradientGeometry["kind"]) => {
    const named = new Map([...written.named].filter(([name]) => ["repeat", "space", ...GEOMETRY_ARGUMENTS[next]].includes(name)));
    // Linear is what a gradient is without a kind, so it is only written where a restyle has another kind to replace.
    if (next !== "linear" || restyles) named.set("kind", next);
    change({ named });
  };
  /** A named argument's number as the gradient has it now, written or not. */
  const measure = (name: "angle" | "x" | "y", fallback: number) => {
    const typed = Number.parseFloat(written.named.get(name) ?? "");
    if (Number.isFinite(typed)) return typed;
    const geometry = drawn?.geometry as Partial<Record<"angle" | "x" | "y", number>> | undefined;
    return geometry?.[name] ?? fallback;
  };
  const setStop = (index: number, stop: WrittenGradient["stops"][number], continuing = false) =>
    change({ stops: written.stops.map((other, i) => (i === index ? stop : other)) }, continuing);
  const restyling = restyles || choosing;
  const restyled = restyles ? gradients.find((choice) => choice.path === written.stops[0].ref) : undefined;
  /** Back to stops of its own: the ones it was restyling, laid out as it is drawn now, so nothing changes to look at. */
  const showStops = () => {
    setChoosing(false);
    if (!restyles || !drawn) return;
    const { geometry } = drawn;
    const named = new Map<string, string>();
    if (geometry.kind !== "linear") named.set("kind", geometry.kind);
    if ("angle" in geometry && geometry.angle !== (geometry.kind === "conic" ? 0 : 180)) named.set("angle", `${geometry.angle}deg`);
    if ("x" in geometry && geometry.x !== 50) named.set("x", `${geometry.x}%`);
    if ("y" in geometry && geometry.y !== 50) named.set("y", `${geometry.y}%`);
    if (geometry.kind === "radial" && geometry.shape !== "ellipse") named.set("shape", geometry.shape);
    if (geometry.kind === "radial" && geometry.size !== "farthest-corner") named.set("size", geometry.size);
    if (drawn.repeat) named.set("repeat", "true");
    if (drawn.space) named.set("space", drawn.space);
    change({ stops: drawn.stops.map((stop) => ({ ref: stop.color.ref, position: stop.position == null ? null : `${stop.position}%` })), named });
  };
  // What the panel can tell of a stop by itself, for when the page cannot draw the gradient because of something
  // elsewhere in the definition: a color written out, a palette color, or a role.
  const sketched = (ref: string): Color | null => {
    const named = constants.find((constant) => constant.path === ref)?.color ?? roles.find((role) => role.path === ref)?.color;
    if (named) return isGradient(named) ? null : named;
    try {
      return parseColor(ref, "stop");
    } catch {
      return null;
    }
  };
  const stopColors: (Color | null)[] = written.stops.map((stop, index) =>
    drawn && drawn.stops.length === written.stops.length ? drawn.stops[index].color.color : restyles ? null : sketched(stop.ref),
  );
  const places = placesOf(written.stops);
  // The ruler lays the stops left to right by position whatever the gradient's kind or angle; a restyle's are the ones it took.
  const ruled = restyles
    ? (drawn?.stops ?? []).map((stop, index, all) => ({ color: stop.color.color, at: stopPositions(all)[index] }))
    : written.stops.flatMap((_, index) => (stopColors[index] ? [{ color: stopColors[index], at: places[index] }] : []));
  const latest = useRef(written);
  latest.current = written;
  const ruler = useRef<HTMLDivElement>(null);
  const placeAt = (clientX: number) => {
    // Matches where the stylesheet puts a handle: inset by half a handle at each end.
    const box = ruler.current!.getBoundingClientRect();
    return Math.round(Math.min(100, Math.max(0, ((clientX - box.left - HANDLE / 2) / (box.width - HANDLE)) * 100)));
  };
  const dragHandle = (start: number, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    let index = start;
    let dragging = false;
    const onMove = (move: PointerEvent) => {
      const moved = withStopAt(latest.current.stops, index, placeAt(move.clientX));
      index = moved.index;
      onChange(writeGradient({ ...latest.current, stops: moved.stops }), dragging);
      dragging = true;
    };
    const onEnd = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onEnd);
      removeEventListener("pointercancel", onEnd);
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onEnd);
    addEventListener("pointercancel", onEnd);
  };
  /** A new stop at `at`, taking the color of the stop before that place. */
  const addStop = (at: number) => {
    const before = Math.max(0, places.filter((place) => place <= at).length - 1);
    change({ stops: withStopAdded(written.stops, written.stops[before].ref, at) });
  };
  const addInWidestGap = () => {
    const gaps = places.slice(1).map((place, index) => place - places[index]);
    const widest = gaps.indexOf(Math.max(...gaps));
    addStop(Math.round((places[widest] + places[widest + 1]) / 2));
  };
  // The gradient as it is laid out: as the page draws it, or from what the panel can tell where the page cannot.
  const laidOut = drawn
    ? paintCss(drawn)
    : stopColors.every((color) => color != null)
      ? gradientCss(
          {
            geometry:
              kind === "linear"
                ? { kind, angle: measure("angle", 180) }
                : kind === "radial"
                  ? {
                      kind,
                      shape: written.named.get("shape") === "circle" ? "circle" : "ellipse",
                      size: RADIAL_SIZES.find((size) => size === written.named.get("size")) ?? "farthest-corner",
                      x: measure("x", 50),
                      y: measure("y", 50),
                    }
                  : { kind, angle: measure("angle", 0), x: measure("x", 50), y: measure("y", 50) },
            repeat: written.named.get("repeat") === "true",
            space: null,
            stops: written.stops.map((stop) => ({ position: stop.position == null ? null : Number.parseFloat(stop.position) })),
          },
          stopColors.map((color) => paintCss(color!)),
        )
      : null;
  const number = (name: "angle" | "x" | "y", unit: string, fallback: number, label: string) => (
    <input
      className="ref-number"
      type="number"
      step={1}
      aria-label={label}
      value={measure(name, fallback)}
      onChange={(event) => {
        if (event.target.value !== "") setNamed(name, `${Number(event.target.value)}${unit}`);
      }}
    />
  );

  return (
    <div className="gradient-controls">
      {ruled.length > 0 && (
        <div
          ref={ruler}
          className="gradient-ruler"
          onPointerDown={(event) => {
            if (!restyles && event.button === 0) addStop(placeAt(event.clientX));
          }}
        >
          <span className={ruled.every((stop) => paintIsOpaque(stop.color)) ? "gradient-ruler-strip swatch" : "gradient-ruler-strip swatch swatch-alpha"}>
            <span className="swatch-color" style={{ background: `linear-gradient(90deg, ${ruled.map((stop) => `${paintCss(stop.color)} calc(${HANDLE / 2}px + ${stop.at / 100} * (100% - ${HANDLE}px))`).join(", ")})` }} />
          </span>
          {!restyles &&
            written.stops.map((stop, index) => (
              <button
                key={index}
                type="button"
                className="gradient-handle"
                style={{ "--at": Math.min(1, Math.max(0, places[index] / 100)), background: stopColors[index] ? paintCss(stopColors[index]) : undefined } as CSSProperties}
                aria-label={`Stop ${index + 1}, ${stop.ref}, at ${places[index]}%; drag, or use Left and Right, to move it`}
                onPointerDown={(event) => dragHandle(index, event)}
                onKeyDown={(event) => {
                  const by = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
                  if (by !== 0) change({ stops: withStopAt(written.stops, index, Math.min(100, Math.max(0, Math.round(places[index]) + by))).stops });
                }}
              />
            ))}
        </div>
      )}
      <div className="gradient-stops">
        <div className="gradient-stops-head">
          {gradients.length > 0 || restyles ? (
            <div className="gradient-tabs" role="tablist" aria-label="What the gradient is made of">
              <button type="button" role="tab" aria-selected={!restyling} disabled={restyles && !drawn} onClick={showStops}>
                Stops
              </button>
              <button type="button" role="tab" aria-selected={restyling} onClick={() => setChoosing(true)}>
                Use
              </button>
            </div>
          ) : (
            <span>Stops</span>
          )}
          {!restyling && (
            <button type="button" className="entry-action" aria-label="Add a stop" onClick={addInWidestGap}>
              <Plus size={14} aria-hidden />
            </button>
          )}
        </div>
        {restyling && (
          <Popup
            title="Choose the gradient to use"
            className="gradient-restyled"
            label={
              <>
                {restyled && (
                  <span className={paintIsOpaque(restyled.color) ? "swatch" : "swatch swatch-alpha"}>
                    <span className="swatch-color" style={{ background: paintCss(restyled.color) }} />
                  </span>
                )}
                <code>{restyles ? written.stops[0].ref : "Choose a gradient"}</code>
                <ChevronDown size={14} aria-hidden />
              </>
            }
            focus="panel"
          >
            {(panel) => (
              <div className="ref-editor gradient-restyle-choices">
                <ChoiceGrid
                  choices={gradients}
                  chosen={restyles ? written.stops[0].ref : null}
                  onChoose={(path) => {
                    setChoosing(false);
                    change({ stops: [{ ref: path, position: null }] });
                    panel.dismiss();
                  }}
                />
              </div>
            )}
          </Popup>
        )}
        {!restyling &&
          written.stops.map((stop, index) => (
          <div key={index} className="gradient-stop">
                <Popup
                  title="Edit stop"
                  className="chip chip-editable gradient-stop-color"
                  label={
                    <>
                      <span className={stopColors[index] && !paintIsOpaque(stopColors[index]) ? "swatch swatch-alpha" : "swatch"}>
                        {stopColors[index] && <span className="swatch-color" style={{ background: paintCss(stopColors[index]) }} />}
                      </span>
                      <code>{stop.ref}</code>
                    </>
                  }
                  focus="panel"
                >
                  {(panel) => (
                    <StopEditor
                      stop={stop.ref}
                      color={stopColors[index]}
                      sources={stopSources}
                      constants={constants}
                      systems={systems}
                      roles={roles}
                      panel={panel}
                      onChange={(ref, continuing) => setStop(index, { ...stop, ref }, continuing)}
                    />
                  )}
                </Popup>
                <input
                  className="ref-number"
                  type="number"
                  aria-label={`Position of stop ${index + 1}, in percent; empty spreads it evenly`}
                  placeholder={String(Math.round(places[index]))}
                  value={stop.position == null ? "" : Number.parseFloat(stop.position)}
                  onChange={(event) => setStop(index, { ...stop, position: event.target.value === "" ? null : `${Number(event.target.value)}%` })}
                  // The rows are in the order of the ruler, so a typed position takes its place once it is whole.
                  onBlur={() => {
                    if (stop.position != null) change({ stops: withStopAt(written.stops, index, Number.parseFloat(stop.position)).stops });
                  }}
                />
                <button
                  type="button"
                  className="entry-action"
                  aria-label={`Remove stop ${index + 1}`}
                  disabled={written.stops.length <= 2}
                  onClick={() => change({ stops: written.stops.filter((_, i) => i !== index) })}
                >
                  <TrashIcon />
                </button>
          </div>
        ))}
      </div>

      <div className="gradient-settings">
        <div className="gradient-stops-head">
          <span>Layout</span>
          <label className="gradient-measure">
            <span>repeat</span>
            <input
              type="checkbox"
              checked={(written.named.get("repeat") ?? String(drawn?.repeat ?? false)) === "true"}
              onChange={(event) => setNamed("repeat", event.target.checked ? "true" : restyles ? "false" : null)}
            />
          </label>
        </div>
        <div className="gradient-layout">
          <span className={ruled.every((stop) => paintIsOpaque(stop.color)) ? "swatch" : "swatch swatch-alpha"} aria-label="The gradient as it is drawn">
            {laidOut && <span className="swatch-color" style={{ background: laidOut }} />}
          </span>
          <div className="gradient-setting">
            <select aria-label="Kind" value={kind} onChange={(event) => setKind(event.target.value as GradientGeometry["kind"])}>
              {KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {kind === "radial" ? (
              <select aria-label="Shape" value={written.named.get("shape") ?? (drawn?.geometry.kind === "radial" ? drawn.geometry.shape : "ellipse")} onChange={(event) => setNamed("shape", event.target.value)}>
                {RADIAL_SHAPES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <label className="gradient-measure">
                <span>angle</span>
                {number("angle", "deg", kind === "conic" ? 0 : 180, "Angle, in degrees")}
              </label>
            )}
          </div>
          {kind !== "linear" && (
            <div className="gradient-setting">
              {kind === "radial" && (
                <select aria-label="Size" value={written.named.get("size") ?? (drawn?.geometry.kind === "radial" ? drawn.geometry.size : "farthest-corner")} onChange={(event) => setNamed("size", event.target.value)}>
                  {RADIAL_SIZES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )}
              <label className="gradient-measure">
                <span>{kind === "radial" ? "at" : "center"}</span>
                {number("x", "%", 50, "Center x, in percent")}
                {number("y", "%", 50, "Center y, in percent")}
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The editor any color is chosen in, on one stop: what it tries and keeps is written into the gradient's text. */
function StopEditor({
  stop,
  color,
  sources,
  constants,
  systems,
  roles,
  panel,
  onChange,
}: {
  stop: string;
  color: Color | null;
  sources: Source[];
  constants: SnapshotConstant[];
  systems: SnapshotSystem[];
  roles: Choice[];
  panel: PopupPanel;
  /** `continuing` is true after the first change: everything tried and kept in one opening is one step. */
  onChange: (ref: string, continuing: boolean) => void;
}) {
  // The stop's text follows what is tried, so what it opened on is taken once.
  const [opened] = useState(stop);
  const changed = useRef(false);
  const change = (ref: string) => {
    onChange(ref, changed.current);
    changed.current = true;
  };
  return (
    <ValueEditor
      value={opened}
      drawn={color ? { kind: "color", color } : { kind: "refused", error: `${stop} does not come to a color yet` }}
      sources={sources}
      constants={constants}
      systems={systems}
      roles={roles}
      transparent
      panel={panel}
      onPreview={(value) => change(value ?? opened)}
      onCommit={(value) => change(value)}
    />
  );
}

/** Where each stop sits along the ruler, in percent, an unwritten position spread as CSS spreads it. */
function placesOf(stops: WrittenGradient["stops"]): number[] {
  return stopPositions(stops.map((stop) => ({ position: stop.position == null ? null : Number.parseFloat(stop.position) })));
}

/**
 * The stops in the order of the ruler, each where `wanted` has it. A stop
 * with no written position is given one only if it would otherwise land
 * somewhere else, so nothing moves but what was moved.
 */
function settled(stops: WrittenGradient["stops"], wanted: number[]): { stops: WrittenGradient["stops"]; order: number[] } {
  const order = stops.map((_, i) => i).sort((a, b) => wanted[a] - wanted[b] || a - b);
  const placed = order.map((i) => stops[i]);
  const places = order.map((i) => wanted[i]);
  for (let pass = 0; pass < placed.length; pass++) {
    const got = placesOf(placed);
    const shifted = placed.findIndex((stop, i) => stop.position == null && Math.abs(got[i] - places[i]) > 0.01);
    if (shifted === -1) break;
    placed[shifted] = { ...placed[shifted], position: `${Number(places[shifted].toFixed(2))}%` };
  }
  return { stops: placed, order };
}

/** The stops with one of them put at `at`, and where that one is now. */
function withStopAt(stops: WrittenGradient["stops"], index: number, at: number): { stops: WrittenGradient["stops"]; index: number } {
  const wanted = placesOf(stops);
  wanted[index] = at;
  const moved = settled(stops.map((stop, i) => (i === index ? { ...stop, position: `${at}%` } : stop)), wanted);
  return { stops: moved.stops, index: moved.order.indexOf(index) };
}

/** The stops with a new one at `at`. */
function withStopAdded(stops: WrittenGradient["stops"], ref: string, at: number): WrittenGradient["stops"] {
  return settled([...stops, { ref, position: `${at}%` }], [...placesOf(stops), at]).stops;
}
