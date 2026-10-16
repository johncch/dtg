import { useEffect, useState } from "react";
import { toOklab } from "../src/color-math.js";
import type { SnapshotBackground } from "../src/snapshot.js";
import { paintCss } from "./paint.js";

const ACTIVE = "colors.activeBackground";
/** OKLab lightness under which the page's own text and borders switch to their light-on-dark set. */
const DARK_BELOW = 0.6;

/**
 * Which of the project's backgrounds the app is drawn on. The list is the
 * project's, in `dtg.config.yaml`; the choice is this browser's.
 */
export function Backgrounds({ backgrounds }: { backgrounds: SnapshotBackground[] }) {
  const [activeName, setActiveName] = useState(() => localStorage.getItem(ACTIVE));
  const active = backgrounds.find((background) => background.name === activeName) ?? backgrounds[0];
  const css = paintCss(active.color);
  const dark = toOklab(active.color)[0] < DARK_BELOW;

  useEffect(() => {
    document.body.style.background = css;
    document.body.style.setProperty("--page-bg", css);
    document.body.classList.toggle("on-dark", dark);
  }, [css, dark]);

  return (
    <div id="bg-section">
      <h2>Background</h2>
      <div className="bg-swatches">
        {backgrounds.map((background) => (
          <button
            key={background.name}
            type="button"
            className="bg-swatch"
            title={background.name}
            aria-label={background.name}
            aria-pressed={background.name === active.name}
            style={{ background: paintCss(background.color) }}
            onClick={() => {
              localStorage.setItem(ACTIVE, background.name);
              setActiveName(background.name);
            }}
          />
        ))}
      </div>
    </div>
  );
}
