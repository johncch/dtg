import { useEffect, useState } from "react";
import { parseColor, toOklab, type Color } from "../src/color-math.js";
import type { SnapshotBackground } from "../src/snapshot.js";
import { paintCss } from "./paint.js";

const ACTIVE = "colors.activeBackground";
const EMBEDDED = window.parent !== window;
/** OKLab lightness under which the page's own text and borders switch to their light-on-dark set. */
const DARK_BELOW = 0.6;

/**
 * Which background the app is drawn on: one per distinct mode background, and
 * the choice is this browser's, remembered by the first mode seen on it. Inside an
 * iframe, the host page can override it with `{ type: "dtg:background",
 * color }` (hex or `oklch()`); `color: null` hands the choice back.
 */
export function Backgrounds({ backgrounds }: { backgrounds: SnapshotBackground[] }) {
  const [activeName, setActiveName] = useState(() => localStorage.getItem(ACTIVE));
  const [hostColor, setHostColor] = useState<Color | null>(null);
  const active = backgrounds.find((background) => background.modes.includes(activeName ?? "")) ?? backgrounds[0];
  const color = hostColor ?? active.color;
  const css = paintCss(color);
  const dark = toOklab(color)[0] < DARK_BELOW;

  useEffect(() => {
    document.body.style.background = css;
    document.body.style.setProperty("--page-bg", css);
    document.body.style.setProperty("--surface-canvas", css);
    document.body.classList.toggle("on-dark", dark);
    document.documentElement.classList.toggle("dark", dark);
  }, [css, dark]);

  useEffect(() => {
    if (!EMBEDDED) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; color?: unknown } | null;
      if (event.source !== parent || data?.type !== "dtg:background") return;
      if (data.color == null) {
        setHostColor(null);
        return;
      }
      try {
        setHostColor(parseColor(data.color, "dtg:background"));
      } catch (error) {
        console.warn((error as Error).message);
      }
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  return (
    <div id="bg-section">
      <h2>Background</h2>
      <div className="bg-swatches">
        {backgrounds.map((background) => (
          <button
            key={background.modes[0]}
            type="button"
            className="bg-swatch"
            title={background.modes.join(", ")}
            aria-label={background.modes.join(", ")}
            aria-pressed={paintCss(background.color) === css}
            style={{ background: paintCss(background.color) }}
            onClick={() => {
              localStorage.setItem(ACTIVE, background.modes[0]);
              setActiveName(background.modes[0]);
              setHostColor(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}
