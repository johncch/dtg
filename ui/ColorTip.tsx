import * as Tooltip from "@radix-ui/react-tooltip";
import { useState, type ReactElement, type ReactNode } from "react";
import {
  channelsIn,
  formatColor,
  isOpaque,
  needsMapping,
  oklabToOklch,
  roundChannel,
  rgbToHex,
  toOklab,
  type Color,
} from "../src/color-math.js";
import { useColorName } from "./names.js";
import { paintCss } from "./paint.js";

const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

type Reach =
  | { where: "srgb" }
  | { where: "p3"; p3: string }
  | { where: "beyond"; p3: string };

function reachOf(color: Color): Reach {
  if (!needsMapping(color, "srgb")) return { where: "srgb" };
  const p3 = formatColor(color, "display-p3");
  return needsMapping(color, "display-p3") ? { where: "beyond", p3 } : { where: "p3", p3 };
}

const REACH_LABEL: Record<Reach["where"], string> = {
  srgb: "sRGB color space",
  p3: "P3 color space",
  beyond: "outside P3",
};

/** Hovering the child shows the color large, with its OKLCH value and which displays can show it. */
export function ColorTip({
  color,
  reference,
  suppressed = false,
  children,
}: {
  color: Color;
  /** Shown under the color's name: the ref it comes from, where it has one. */
  reference?: ReactNode;
  /** Keeps the tooltip shut while something else, like the picker, is open on the same element. */
  suppressed?: boolean;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Root open={open && !suppressed} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side="top" sideOffset={6} collisionPadding={8}>
          <ColorFacts color={color} reference={reference} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** The sRGB color nearest to it, as hex, rgb() and hsl(). */
function srgbFormsOf(color: Color): { hex: string; rgb: string; hsl: string } {
  const [r, g, b] = channelsIn(color, "srgb").map((channel) => Math.max(0, Math.min(255, roundChannel(channel))));
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const spread = max - min;
  const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * lightness - 1));
  const sixth =
    spread === 0
      ? 0
      : max === r / 255
        ? ((g - b) / 255 / spread + 6) % 6
        : max === g / 255
          ? (b - r) / 255 / spread + 2
          : (r - g) / 255 / spread + 4;
  const hsl = `${Math.round(sixth * 60) % 360}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%`;
  const alpha = trim(color.alpha, 3);
  if (isOpaque(color)) {
    return { hex: rgbToHex([r, g, b]), rgb: `rgb(${r}, ${g}, ${b})`, hsl: `hsl(${hsl})` };
  }
  return {
    hex: rgbToHex([r, g, b]) + Math.round(color.alpha * 255).toString(16).padStart(2, "0"),
    rgb: `rgba(${r}, ${g}, ${b}, ${alpha})`,
    hsl: `hsla(${hsl}, ${alpha})`,
  };
}

/** The color large, with its name, where it comes from, its values, and which displays can show it. */
export function ColorFacts({ color, reference }: { color: Color; reference?: ReactNode }) {
  const [L, C, H] = oklabToOklch(toOklab(color));
  // A gray has no hue; atan2 of two rounding errors is not worth printing.
  const hue = C < 5e-5 ? 0 : H;
  const alpha = isOpaque(color) ? "" : ` / ${trim(color.alpha, 3)}`;
  const srgb = srgbFormsOf(color);
  const reach = reachOf(color);
  const name = useColorName(color);

  return (
    <div className="color-facts">
      {(name || reference) && (
        <div className="color-facts-head">
          {name && <span className="tip-name">{name}</span>}
          {reference}
        </div>
      )}
      <div className="color-facts-body">
        <div className={isOpaque(color) ? "tip-swatch" : "tip-swatch tip-swatch-translucent"}>
          <span style={{ background: paintCss(color) }} />
        </div>
        <div className="tip-facts">
          <Copyable value={srgb.hex} />
          <Copyable value={srgb.rgb} />
          <Copyable value={srgb.hsl} />
          <Copyable value={`oklch(${trim(L, 3)} ${trim(C, 3)} ${trim(hue, 1)}${alpha})`} />
          {reach.where !== "srgb" && (
            <Copyable value={reach.p3} note={reach.where === "beyond" ? "nearest P3" : undefined} />
          )}
          <span className="tip-status">
            {REACH_LABEL[reach.where]}
            {reach.where !== "srgb" && " · hex, rgb and hsl are the nearest sRGB"}
            {!isOpaque(color) && ` · ${trim(color.alpha * 100, 1)}% opacity`}
          </span>
        </div>
      </div>
    </div>
  );
}

/** One value, with a button that copies it; the button says so for a moment after. */
function Copyable({ value, note }: { value: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <span className="copyable">
      <code>{value}</code>
      {note && <span className="muted"> {note}</span>}
      <button type="button" className="copy" aria-label={`Copy ${value}`} onClick={copy}>
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}
