import {
  assertKnownParams,
  type AlgorithmImpl,
  type AlgorithmPreview,
  type PreviewControl,
} from "../contract.js";
import {
  alphaComposite,
  assertHex,
  hexToRgb,
  rgbToHex,
} from "../color-math.js";

/**
 * A named palette of colors over one shared ground. Unlike ink-ramp, which
 * sweeps a single ink across alphas, compose holds several anchors that
 * share a bottom — the shape a tinted-surface palette actually has.
 *
 * Weight belongs to the use, not the anchor: the same red is a surface tint
 * at 6% and a border at 100%, so the selector carries both coordinates and
 * the emitted name still reads as the recipe.
 */
export const compose: AlgorithmImpl = {
  description:
    "A palette of named colors composited over one shared bottom. The selector is a color and a weight — `red@6` is that anchor at 6% over the ground, `red@100` is the anchor itself — so one palette serves both tints and full-strength use. Steps are opaque; transparent() returns the anchor at its weight, uncomposited.",

  declaredSelectors(params) {
    assertKnownParams(params, ["bottom", "tops"], "compose");
    assertHex(params.bottom, "compose param 'bottom'");
    parseTops(params);
    return null;
  },

  resolveStep(params, selector) {
    const { color, alpha, topOnly } = parseSelector(params, selector);
    const [r, g, b] = hexToRgb(color);
    if (topOnly) {
      return { css: `rgba(${r}, ${g}, ${b}, ${alpha / 100})`, opaque: false };
    }
    const bottom = hexToRgb(assertHex(params.bottom, "compose param 'bottom'"));
    return {
      css: rgbToHex(alphaComposite([r, g, b], bottom, alpha / 100)),
      opaque: true,
    };
  },

  publicStep(params, selector) {
    // Name from the selector text; compose keeps alpha unscaled so there is
    // no round-trip here, but the rule is the same as ink-ramp's.
    const { name, topOnly } = parseSelector(params, selector);
    const at = selector.indexOf("@");
    const slash = selector.indexOf("/");
    const weight = selector.slice(at + 1, slash === -1 ? undefined : slash);
    return `${name}-${weight.replace(/\./g, "_")}${topOnly ? "-top" : ""}`;
  },

  stepOrder(params, selector) {
    const names = Object.keys(parseTops(params));
    const { name, alpha, topOnly } = parseSelector(params, selector);
    // Declaration order first, then weight; padded so the compare stays
    // lexical while still reading 3.5 as less than 12.
    return `${String(names.indexOf(name)).padStart(4, "0")}:${alpha
      .toFixed(4)
      .padStart(9, "0")}:${topOnly ? "1" : "0"}`;
  },

  preview(params, selectors) {
    const tops = parseTops(params);
    const names = Object.keys(tops);
    const controls: PreviewControl[] = [
      {
        kind: "color",
        path: "bottom",
        label: "ground",
        value: assertHex(params.bottom, "compose param 'bottom'"),
      },
      ...names.map(
        (name): PreviewControl => ({
          kind: "color",
          path: `tops.${name}`,
          label: name,
          value: tops[name],
        }),
      ),
    ];
    const preview: AlgorithmPreview = {
      shape: "palette",
      controls,
      composite: {
        selectors: names.map((name) => `${name}@{weight}`),
        vars: [
          {
            name: "weight",
            label: "weight",
            value: commonAlpha(selectors),
            min: 0,
            max: 100,
            step: 0.5,
            unit: "%",
          },
        ],
      },
    };
    return preview;
  },
};

/** The weight this palette is mostly used at — the tuner's starting point. */
function commonAlpha(selectors: string[]): number {
  const counts = new Map<number, number>();
  for (const selector of selectors) {
    const at = selector.indexOf("@");
    if (at === -1) continue;
    const alpha = Number(selector.slice(at + 1));
    if (!Number.isFinite(alpha) || alpha >= 100) continue;
    counts.set(alpha, (counts.get(alpha) ?? 0) + 1);
  }
  let best = 8;
  let seen = 0;
  for (const [alpha, n] of counts) {
    if (n > seen) [best, seen] = [alpha, n];
  }
  return best;
}

function parseTops(params: Record<string, unknown>): Record<string, string> {
  const raw = params.tops;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("compose param 'tops': expected a map of name to a hex color");
  }
  const tops: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    tops[name] = assertHex(value, `compose top "${name}"`);
  }
  if (Object.keys(tops).length === 0) {
    throw new Error("compose param 'tops': declares no colors");
  }
  return tops;
}

function parseSelector(
  params: Record<string, unknown>,
  selector: string,
): { name: string; color: string; alpha: number; topOnly: boolean } {
  const tops = parseTops(params);
  let topOnly = false;
  const slash = selector.indexOf("/");
  if (slash !== -1) {
    const suffix = selector.slice(slash + 1);
    if (suffix !== "top") {
      throw new Error(
        `compose selector "${selector}": unknown form "${suffix}" (known: top)`,
      );
    }
    topOnly = true;
    selector = selector.slice(0, slash);
  }
  const at = selector.indexOf("@");
  if (at === -1) {
    throw new Error(
      `compose selector "${selector}": needs a weight — write "${selector}@100" for the color itself, or "${selector}@6" for a 6% tint`,
    );
  }
  const name = selector.slice(0, at);
  const color = tops[name];
  if (!color) {
    throw new Error(
      `compose: unknown color "${name}" (declared: ${Object.keys(tops).join(", ")})`,
    );
  }
  const rest = selector.slice(at + 1);
  const alpha = Number(rest);
  if (rest === "" || !Number.isFinite(alpha) || alpha < 0 || alpha > 100) {
    throw new Error(
      `compose selector "${selector}": weight must be a number 0-100, got ${JSON.stringify(rest)}`,
    );
  }
  return { name, color, alpha, topOnly };
}
