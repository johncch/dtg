import { assertKnownParams, type AlgorithmImpl } from "../contract.js";
import {
  alphaComposite,
  assertHex,
  hexToRgb,
  rgbToHex,
} from "../color-math.js";

type Top = { color: string; alpha: number };

/**
 * A named palette of colors composited over one ground. Unlike ink-ramp,
 * which sweeps a single ink across alphas, compose holds several tops that
 * share a bottom — the shape a tinted-surface palette actually has.
 */
export const compose: AlgorithmImpl = {
  description:
    "A palette of named tops composited over one shared bottom. Each top declares the alpha it is normally used at, so the selector is the top's name — `blush` — and an optional `@alpha` overrides that weight for a one-off, as in `blush@100` for the pure hue. Steps are opaque; transparent() returns the top at its alpha, uncomposited.",

  declaredSelectors(params) {
    assertKnownParams(params, ["bottom", "tops"], "compose");
    assertHex(params.bottom, "compose param 'bottom'");
    parseTops(params);
    return null;
  },

  resolveStep(params, selector) {
    const bottom = hexToRgb(assertHex(params.bottom, "compose param 'bottom'"));
    const { top, alpha } = parseSelector(params, selector);
    return {
      css: rgbToHex(alphaComposite(hexToRgb(top.color), bottom, alpha / 100)),
      opaque: true,
    };
  },

  resolveTranslucent(params, selector) {
    const { top, alpha } = parseSelector(params, selector);
    const [r, g, b] = hexToRgb(top.color);
    return `rgba(${r}, ${g}, ${b}, ${alpha / 100})`;
  },

  publicStep(_params, selector) {
    const at = selector.indexOf("@");
    if (at === -1) return selector;
    return `${selector.slice(0, at)}-${selector.slice(at + 1).replace(/\./g, "_")}`;
  },

  stepOrder(params, selector) {
    const names = Object.keys(parseTops(params));
    const { name, alpha } = parseSelector(params, selector);
    // Declaration order first, then weight; padded so the compare is lexical
    // but still reads 3.5 as less than 12.
    return `${String(names.indexOf(name)).padStart(4, "0")}:${alpha
      .toFixed(4)
      .padStart(9, "0")}`;
  },
};

function parseTops(params: Record<string, unknown>): Record<string, Top> {
  const raw = params.tops;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "compose param 'tops': expected a map of name to { color, alpha }",
    );
  }
  const tops: Record<string, Top> = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`compose top "${name}": expected { color, alpha }`);
    }
    const fields = entry as Record<string, unknown>;
    for (const key of Object.keys(fields)) {
      if (key !== "color" && key !== "alpha") {
        throw new Error(
          `compose top "${name}": unknown key "${key}" (known: color, alpha)`,
        );
      }
    }
    tops[name] = {
      color: assertHex(fields.color, `compose top "${name}" color`),
      alpha: parseAlpha(fields.alpha, `compose top "${name}" alpha`),
    };
  }
  if (Object.keys(tops).length === 0) {
    throw new Error("compose param 'tops': declares no tops");
  }
  return tops;
}

function parseSelector(
  params: Record<string, unknown>,
  selector: string,
): { name: string; top: Top; alpha: number } {
  const tops = parseTops(params);
  const at = selector.indexOf("@");
  const name = at === -1 ? selector : selector.slice(0, at);
  const top = tops[name];
  if (!top) {
    throw new Error(
      `compose: unknown top "${name}" (declared: ${Object.keys(tops).join(", ")})`,
    );
  }
  if (at === -1) return { name, top, alpha: top.alpha };
  const rest = selector.slice(at + 1);
  if (rest === "") {
    throw new Error(
      `compose selector "${selector}": "@" with no alpha — write "${name}" for the declared weight`,
    );
  }
  return {
    name,
    top,
    alpha: parseAlpha(rest, `compose selector "${selector}" alpha`),
  };
}

function parseAlpha(value: unknown, context: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(
      `${context}: expected a number 0-100, got ${JSON.stringify(value)}`,
    );
  }
  return n;
}
