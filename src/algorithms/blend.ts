import {
  assertKnownParams,
  type AlgorithmImpl,
  type AlgorithmPreview,
  type PreviewControl,
} from "../contract.js";
import {
  assertHex,
  colorFromRgb,
  hexToRgb,
  mixIn,
  BLEND_SPACES,
} from "../color-math.js";
import type { BlendSpace } from "../color-math.js";

/**
 * One base colour and several named colours to blend toward, at a weight
 * given per ref. This is CSS's own `color-mix(in <space>, a p%, b)` with N
 * second operands sharing one first — so `warm/red@6` reads as six percent
 * of the way from base toward red.
 *
 * The space matters and is not a detail: the same two colours interpolated
 * in sRGB and OKLab land somewhere different, and only sRGB reproduces what
 * a browser or design tool would render.
 */
export const blend: AlgorithmImpl = {
  description:
    "A base colour and several named colours to blend toward. The selector is a name and a weight — `red@6` is six percent of the way from the base toward red, `red@100` is red itself — so one palette serves tints and full strength. This is `color-mix(in <space>, red 6%, base)`; `space` chooses the interpolation space and defaults to srgb, which is what browsers and design tools do. Adding `/alpha` emits the toward colour carrying the weight as opacity, for the browser to blend at render time.",

  declaredSelectors(params) {
    assertKnownParams(params, ["base", "toward", "space"], "blend");
    assertHex(params.base, "blend param 'base'");
    parseToward(params);
    spaceOf(params);
    return null;
  },

  resolveStep(params, selector) {
    const base = assertHex(params.base, "blend param 'base'");
    const { color, alpha, alphaOnly } = parseSelector(params, selector);
    if (alphaOnly) {
      const space = spaceOf(params);
      if (space !== "srgb") {
        throw new Error(
          `blend selector "${selector}": /alpha defers the blend to the browser, which always blends in srgb — this system blends in ${space}, so the two would disagree`,
        );
      }
      return { color: colorFromRgb(hexToRgb(color), "srgb", alpha / 100) };
    }
    return { color: mixIn(color, base, alpha / 100, spaceOf(params)) };
  },

  publicStep(params, selector) {
    const { name, alphaOnly } = parseSelector(params, selector);
    const at = selector.indexOf("@");
    const slash = selector.indexOf("/");
    const weight = selector.slice(at + 1, slash === -1 ? undefined : slash);
    return `${name}-${weight.replace(/\./g, "_")}${alphaOnly ? "-alpha" : ""}`;
  },

  stepOrder(params, selector) {
    const names = Object.keys(parseToward(params));
    const { name, alpha, alphaOnly } = parseSelector(params, selector);
    return `${String(names.indexOf(name)).padStart(4, "0")}:${alpha
      .toFixed(4)
      .padStart(9, "0")}:${alphaOnly ? "1" : "0"}`;
  },

  preview(params, selectors) {
    const toward = parseToward(params);
    const names = Object.keys(toward);
    const controls: PreviewControl[] = [
      {
        kind: "select",
        path: "space",
        label: "blend in",
        value: spaceOf(params),
        options: BLEND_SPACES.filter((s) => s.emittable).map((s) => ({
          value: s.id,
          label: s.label,
        })),
      },
      {
        kind: "color",
        path: "base",
        label: "base",
        value: assertHex(params.base, "blend param 'base'"),
      },
      ...names.map(
        (name): PreviewControl => ({
          kind: "color",
          path: `toward.${name}`,
          label: name,
          value: toward[name],
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

function spaceOf(params: Record<string, unknown>): BlendSpace {
  const raw = params.space;
  if (raw == null) return "srgb";
  const emittable = BLEND_SPACES.filter((s) => s.emittable).map((s) => s.id);
  if (typeof raw === "string" && !emittable.includes(raw as BlendSpace)) {
    const known = BLEND_SPACES.find((s) => s.id === raw);
    if (known) {
      throw new Error(
        `blend param 'space': "${raw}" is not emittable yet — a blend there produces a value the CSS emitter cannot ship with an sRGB fallback, so the stylesheet would silently define nothing. Compare the spaces at /blend in the dev server.`,
      );
    }
  }
  if (typeof raw !== "string" || !emittable.includes(raw as BlendSpace)) {
    throw new Error(
      `blend param 'space': expected one of ${emittable.join(", ")}, got ${JSON.stringify(raw)}`,
    );
  }
  return raw as BlendSpace;
}

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

function parseToward(params: Record<string, unknown>): Record<string, string> {
  const raw = params.toward;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "blend param 'toward': expected a map of name to a hex color",
    );
  }
  const toward: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    toward[name] = assertHex(value, `blend colour "${name}"`);
  }
  if (Object.keys(toward).length === 0) {
    throw new Error("blend param 'toward': declares no colours");
  }
  return toward;
}

function parseSelector(
  params: Record<string, unknown>,
  selector: string,
): { name: string; color: string; alpha: number; alphaOnly: boolean } {
  const toward = parseToward(params);
  let alphaOnly = false;
  const slash = selector.indexOf("/");
  if (slash !== -1) {
    const suffix = selector.slice(slash + 1);
    if (suffix !== "alpha") {
      throw new Error(
        `blend selector "${selector}": unknown form "${suffix}" (known: alpha)`,
      );
    }
    alphaOnly = true;
    selector = selector.slice(0, slash);
  }
  const at = selector.indexOf("@");
  if (at === -1) {
    throw new Error(
      `blend selector "${selector}": needs a weight — "${selector}@100" for the colour itself, "${selector}@6" for six percent of the way from the base`,
    );
  }
  const name = selector.slice(0, at);
  const color = toward[name];
  if (!color) {
    throw new Error(
      `blend: unknown colour "${name}" (declared: ${Object.keys(toward).join(", ")})`,
    );
  }
  const rest = selector.slice(at + 1);
  const alpha = Number(rest);
  if (rest === "" || !Number.isFinite(alpha) || alpha < 0 || alpha > 100) {
    throw new Error(
      `blend selector "${selector}": weight must be a number 0-100, got ${JSON.stringify(rest)}`,
    );
  }
  return { name, color, alpha, alphaOnly };
}
