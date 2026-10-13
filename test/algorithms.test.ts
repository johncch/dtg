import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseParams } from "../dist/params.js";
import { algorithmFor } from "../dist/resolve.js";
import { allSelectors } from "../dist/selector.js";
import { step } from "./step.ts";
import {
  type Color,
  formatColor,
  hexToOklab,
  isOpaque,
  oklabToOklch,
} from "../dist/color-math.js";

const css = (v: { color: Color }) => formatColor(v.color, "srgb");

const tint = algorithmFor("tint")!;
const blend = algorithmFor("blend")!;
const overlay = algorithmFor("overlay")!;

const SKY = { base: "#fafdff", tint: "#001a28" };
const WARM = { base: "#ffffff", toward: { red: "#b30a0a", blue: "#6192bb" } };

describe("tint", () => {
  test("composites; the tint form returns the layer instead", () => {
    assert.equal(css(step(tint, SKY, "3")), "#f3f6f9");
    assert.equal(css(step(tint, SKY, "3 tint")), "rgba(0, 26, 40, 0.03)");
  });
  test("public names survive a fractional alpha", () => {
    // Regression: deriving the name from the parsed float produced
    // "3_5000000000000004" because parseAlpha divides by 100.
    assert.equal(step(tint, SKY, "3.5").publicStep, "3_5");
    assert.equal(step(tint, SKY, "3.5 tint").publicStep, "3_5-tint");
    assert.equal(step(tint, SKY, "15").publicStep, "15");
  });
  test("rejects bad selectors with a pointed message", () => {
    assert.throws(() => step(tint, SKY, "140"), /0–100|0-100/);
    assert.throws(() => step(tint, SKY, "3 raw"), /unknown form "raw"/);
    assert.throws(() => step(tint, SKY, "abc"), /must be a number/);
  });
});

describe("blend", () => {
  test("blends toward a named color; the alpha form defers to the browser", () => {
    assert.equal(css(step(blend, WARM, "red 6")), "#faf0f0");
    assert.equal(css(step(blend, WARM, "red 6 alpha")), "rgba(179, 10, 10, 0.06)");
    assert.equal(css(step(blend, WARM, "red 100")), "#b30a0a");
  });
  test("selectors need a weight and a known color", () => {
    assert.throws(() => step(blend, WARM, "red"), /expected color weight/);
    assert.throws(() => step(blend, WARM, "green 6"), /unknown color/);
    assert.throws(() => step(blend, WARM, "red x"), /must be a number/);
    assert.throws(() => step(blend, WARM, "red 6 x"), /unknown form "x"/);
  });
  test("orders by declaration, then weight, then form", () => {
    const order = ["blue 6", "red 100", "red 6", "red 6 alpha"]
      .map((s) => [s, step(blend, WARM, s).order] as const)
      .sort((a, b) => {
        const at = a[1].findIndex((key, i) => key !== b[1][i]);
        return a[1][at] - b[1][at];
      })
      .map(([s]) => s);
    assert.deepEqual(order, ["red 6", "red 6 alpha", "red 100", "blue 6"]);
  });
});

describe("overlay", () => {
  test("never composites, so it has no uncomposited form", () => {
    assert.equal(css(step(overlay, { color: "#000000" }, "40")), "rgba(0, 0, 0, 0.4)");
    // There is no ground to drop, so the selector form other algorithms
    // publish simply is not part of overlay's vocabulary.
    assert.throws(
      () => step(overlay, { color: "#000000" }, "40 tint"),
      /unknown form "tint"/,
    );
  });
});

describe("params", () => {
  test("reject unknown params rather than ignoring them", () => {
    assert.throws(
      () => parseParams(tint, { ...SKY, shade: 3 }),
      /unknown param "shade"/,
    );
    assert.throws(
      () => parseParams(blend, { ...WARM, weight: 6 }),
      /unknown param "weight"/,
    );
  });
});

describe("blend space", () => {
  const P = { base: "#ffffff", toward: { red: "#b30a0a" } };

  test("defaults to srgb, which is what a browser would render", () => {
    assert.equal(css(step(blend, P, "red 6")), "#faf0f0");
    assert.equal(
      css(step(blend, { ...P, space: "srgb" }, "red 6")),
      "#faf0f0",
    );
  });

  test("each space lands somewhere different", () => {
    const at = (space: string) =>
      css(step(blend, { ...P, space }, "red 6"));
    assert.equal(at("srgb"), "#faf0f0");
    assert.equal(at("srgb-linear"), "#fbf8f8");
    assert.equal(at("oklab"), "#fdf2f0");
    assert.notEqual(at("display-p3"), at("srgb"));
  });

  test("a display-p3 blend keeps that space, so emit can layer it", () => {
    const mixed = step(blend, { ...P, space: "display-p3" }, "red 6");
    assert.equal(mixed.color.space, "display-p3");
  });

  test("endpoints agree in every space", () => {
    for (const space of ["srgb", "srgb-linear", "oklab", "display-p3"]) {
      assert.equal(css(step(blend, { ...P, space }, "red 100")), "#b30a0a");
      assert.equal(css(step(blend, { ...P, space }, "red 0")), "#ffffff");
    }
  });

  test("an unknown space is rejected", () => {
    assert.throws(
      () => parseParams(blend, { ...P, space: "cmyk" }),
      /expected one of srgb, srgb-linear, oklab, display-p3/,
    );
  });

  test("the alpha form is refused unless the system blends in srgb", () => {
    // The browser blends a translucent value in srgb, so deferring the blend
    // from an oklab system would silently disagree with its flattened steps.
    assert.equal(
      css(step(blend, P, "red 6 alpha")),
      "rgba(179, 10, 10, 0.06)",
    );
    assert.throws(
      () => step(blend, { ...P, space: "oklab" }, "red 6 alpha"),
      /always blends in srgb/,
    );
  });
});

describe("scale", () => {
  const scale = algorithmFor("scale")!;
  const THEME = {
    base: "#03a2e8",
    toward: ["#fafdff", "#001a28"],
    hueShift: 15,
    stops: { "50": 0.05, "200": 0.3, "500": 1, "800": 0.3, "950": 0.05 },
  };

  test("declares its stops, so the palette emits in full", () => {
    const shape = scale.selector(parseParams(scale, THEME).values);
    assert.deepEqual(allSelectors(shape), [
      "50",
      "200",
      "500",
      "800",
      "950",
    ]);
  });

  test("the 500 stop is the base exactly", () => {
    assert.equal(css(step(scale, THEME, "500")), "#03a2e8");
  });

  test("stops below 500 lighten, above 500 darken", () => {
    const l = (hex: string) => hexToOklab(hex)[0];
    const at = (s: string) => css(step(scale, THEME, s));
    assert.ok(l(at("50")) > l(at("200")), "50 lighter than 200");
    assert.ok(l(at("200")) > l(at("500")), "200 lighter than 500");
    assert.ok(l(at("500")) > l(at("800")), "500 lighter than 800");
    assert.ok(l(at("800")) > l(at("950")), "800 lighter than 950");
  });

  test("every stop is opaque", () => {
    for (const s of ["50", "200", "500", "800", "950"]) {
      assert.equal(isOpaque(step(scale, THEME, s).color), true);
    }
  });

  test("hueShift 0 holds the base hue; 100 lets it travel", () => {
    // Measured at 800, not 50: the extreme stops have chroma near 0.01,
    // where 8-bit rounding moves the *measured* hue by degrees regardless of
    // what the computation did. Hue is only meaningful with chroma to hold it.
    const hue = (hex: string) => oklabToOklch(hexToOklab(hex))[2];
    const base = hue("#03a2e8");
    const drift = (hueShift: number) =>
      Math.abs(hue(css(step(scale, { ...THEME, hueShift }, "800"))) - base);
    assert.ok(drift(0) < 1, `locked hue drifted ${drift(0)}`);
    assert.ok(
      drift(100) > drift(0),
      `hueShift 100 (${drift(100)}) should travel further than 0 (${drift(0)})`,
    );
    assert.ok(drift(50) > drift(0), "and 50 further than 0");
  });

  test("an undeclared stop is refused, with the declared ones listed", () => {
    assert.throws(
      () => step(scale, THEME, "600"),
      /unknown stop "600" \(declared: 50, 200, 500, 800, 950\)/,
    );
  });

  test("toward must name both ends", () => {
    assert.throws(
      () => step(scale, { ...THEME, toward: ["#ffffff"] }, "50"),
      /param 'toward': expected 2 items, got 1/,
    );
  });

  test("stop names must be numeric, since the sides depend on it", () => {
    assert.throws(
      () =>
        step(scale, { ...THEME, stops: { light: 0.05, "500": 1 } },
          "light",
        ),
      /stop names must be numeric/,
    );
  });

  test("unknown params are rejected", () => {
    assert.throws(
      () => parseParams(scale, { ...THEME, curve: 2 }),
      /unknown param "curve"/,
    );
  });
});
