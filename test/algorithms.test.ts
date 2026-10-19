import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseParams } from "../dist/params.js";
import { algorithmFor, resolveDefinition } from "../dist/resolve.js";
import { step } from "./step.ts";
import {
  type Color,
  convert,
  formatColor,
  inGamut,
  hexToOklab,
  isOpaque,
  oklabToOklch,
  parseColor,
  toOklab,
} from "../dist/color-math.js";

const css = (v: { color: Color }) => formatColor(v.color, "srgb");

const tint = algorithmFor("tint")!;
const overlay = algorithmFor("overlay")!;

const SKY = { base: "#fafdff", tint: "#001a28" };

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
  });
});

describe("scale", () => {
  const scale = algorithmFor("scale")!;
  const THEME = {
    base: "#03a2e8",
    toward: ["#fafdff", "#001a28"],
    hueShift: 15,
    midpoint: 0.4,
  };

  test("takes any stop from 0 to 1000", () => {
    const shape = scale.selector(parseParams(scale, THEME).values);
    assert.deepEqual(shape.fields, [{ name: "stop", kind: "number", min: 0, max: 1000 }]);
    assert.equal(isOpaque(step(scale, THEME, "250").color), true);
  });

  test("its ends are the two targets, when hue is free to travel", () => {
    const free = { ...THEME, hueShift: 100 };
    assert.equal(css(step(scale, free, "0")), "#fafdff");
    assert.equal(css(step(scale, free, "1000")), "#001a28");
  });

  test("a lower midpoint keeps the ends paler and deeper for longer", () => {
    const l = (midpoint: number, stop: string) => hexToOklab(css(step(scale, { ...THEME, midpoint }, stop)))[0];
    assert.ok(l(0.3, "250") > l(0.5, "250"), "paler at 250");
    assert.ok(l(0.3, "750") < l(0.5, "750"), "deeper at 750");
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

  test("a stop outside 0–1000 is refused", () => {
    assert.throws(() => step(scale, THEME, "1200"), /stop must be a number 0–1000/);
  });

  test("toward must name both ends", () => {
    assert.throws(
      () => step(scale, { ...THEME, toward: ["#ffffff"] }, "50"),
      /param 'toward': expected 2 items, got 1/,
    );
  });

  test("midpoint lies strictly between 0 and 1", () => {
    assert.throws(() => step(scale, { ...THEME, midpoint: 1 }, "250"), /midpoint must be between 0 and 1/);
  });

  test("unknown params are rejected", () => {
    assert.throws(
      () => parseParams(scale, { ...THEME, curve: 2 }),
      /unknown param "curve"/,
    );
  });
});

describe("a bounded number param", () => {
  test("is refused outside its declared range", () => {
    const scale = algorithmFor("scale")!;
    const theme = { base: "#03a2e8", toward: ["#fafdff", "#001a28"] };
    assert.throws(() => parseParams(scale, { ...theme, hueShift: 120 }), /param 'hueShift': expected 0–100, got 120/);
    assert.doesNotThrow(() => parseParams(scale, { ...theme, hueShift: 100 }));
  });
});

describe("color spaces: how a color is written never reaches the math", () => {
  const scale = algorithmFor("scale")!;
  const distance = (a: Color, b: Color) => {
    const [x, y] = [toOklab(a), toOklab(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };
  const GREEN_500 = "oklch(72.3% 0.219 149.579)";

  test("the same blue written as hex and as display-p3 gives the same scale", () => {
    const p3 = convert(parseColor("#3b82f6", "blue"), "display-p3").coords;
    const asP3 = `color(display-p3 ${p3.map((c) => c.toFixed(12)).join(" ")})`;
    const ends = { toward: ["#ffffff", "#000000"], hueShift: 0, midpoint: 0.5 };
    for (const stop of ["100", "250", "750", "900"]) {
      const fromHex = step(scale, { ...ends, base: "#3b82f6" }, stop).color;
      const fromP3 = step(scale, { ...ends, base: asP3 }, stop).color;
      assert.ok(distance(fromHex, fromP3) < 1e-6, `stop ${stop} differs by ${distance(fromHex, fromP3)}`);
    }
  });

  test("an oklch base outside sRGB is not clipped next to 500", () => {
    const params = { base: GREEN_500, toward: ["#ffffff", "#000000"], hueShift: 0, midpoint: 0.5 };
    const at500 = step(scale, params, "500").color;
    for (const stop of ["499", "501"]) {
      const d = distance(step(scale, params, stop).color, at500);
      assert.ok(d < 0.002, `stop ${stop} is ${d} from the base`);
    }
  });

  test("a full tint toward a color outside sRGB is that color", () => {
    const full = step(tint, { base: "#ffffff", tint: GREEN_500 }, "100").color;
    assert.ok(distance(full, parseColor(GREEN_500, "green")) < 1e-6);
  });

  test("a gray base takes its hue from the end it blends toward", () => {
    const hue = (c: Color) => oklabToOklch(toOklab(c))[2];
    const params = { base: "#808080", toward: ["#ffffff", "#1d3a8a"], hueShift: 0, midpoint: 0.5 };
    const blue = hue(parseColor("#1d3a8a", "blue"));
    assert.ok(Math.abs(hue(step(scale, params, "750").color) - blue) < 2);
  });
});

describe("curve", () => {
  const curve = algorithmFor("curve")!;
  const BLUE = { anchor: "#3b82f6" };
  const lch = (c: Color) => oklabToOklch(toOklab(c));
  const near = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) < tolerance;

  test("the anchor sits exactly at `at`", () => {
    assert.equal(css(step(curve, BLUE, "500")), "#3b82f6");
    assert.equal(css(step(curve, { ...BLUE, at: 400 }, "400")), "#3b82f6");
  });

  test("with straight easings, lightness runs evenly from each end to the anchor", () => {
    const params = { ...BLUE, lightness: { from: 0.95, to: 0.2 } };
    const [anchorL] = lch(parseColor("#3b82f6", "blue"));
    const L = (stop: string) => lch(step(curve, params, stop).color)[0];
    assert.ok(near(L("0"), 0.95));
    assert.ok(near(L("1000"), 0.2));
    assert.ok(near(L("250"), (0.95 + anchorL) / 2, 1e-4));
    assert.ok(near(L("750"), (anchorL + 0.2) / 2, 1e-4));
  });

  test("steps stay inside the gamut while chroma is at most 1", () => {
    for (const gamut of ["srgb", "display-p3"] as const) {
      const params = { ...BLUE, gamut, chroma: { from: 1, to: 1 } };
      for (let stop = 0; stop <= 1000; stop += 50) {
        if (stop === 500) continue;
        assert.ok(inGamut(toOklab(step(curve, params, String(stop)).color), gamut, 1e-5), `${gamut} stop ${stop}`);
      }
    }
  });

  test("hue is degrees from the anchor's hue", () => {
    const [, , anchorHue] = lch(parseColor("#3b82f6", "blue"));
    const params = { ...BLUE, hue: { from: -20, to: 15 } };
    assert.ok(near(lch(step(curve, params, "0").color)[2], anchorHue - 20, 1e-3));
    assert.ok(near(lch(step(curve, params, "1000").color)[2], anchorHue + 15, 1e-3));
  });

  test("an easing bends one side only", () => {
    const L = (params: object, stop: string) => lch(step(curve, params, stop).color)[0];
    const eased = { ...BLUE, lightness: { easing: [[0.8, 0, 1, 0.2], [0.33, 0.33, 0.67, 0.67]] } };
    assert.ok(L(eased, "250") > L(BLUE, "250") + 0.05, "the light side lags toward its end");
    assert.ok(near(L(eased, "750"), L(BLUE, "750")));
  });

  test("steps next to the anchor are next to it in color", () => {
    const anchor = toOklab(step(curve, BLUE, "500").color);
    for (const stop of ["499", "501"]) {
      const [L, a, b] = toOklab(step(curve, BLUE, stop).color);
      assert.ok(Math.hypot(L - anchor[0], a - anchor[1], b - anchor[2]) < 0.005, stop);
    }
  });

  test("a curve takes only from, to and easing, within bounds, with x values 0–1", () => {
    assert.throws(() => step(curve, { ...BLUE, lightness: { from: 0.9, start: 1 } }, "500"), /unknown field "start"/);
    assert.throws(() => step(curve, { ...BLUE, lightness: { from: 1.2 } }, "500"), /lightness'\.from: expected 0–1, got 1\.2/);
    assert.throws(
      () => step(curve, { ...BLUE, chroma: { easing: [[0, 0, 1, 1], [1.2, 0, 1, 1]] } }, "500"),
      /chroma'\.easing, after it: x values must be 0–1/,
    );
  });

  test("a stop outside 0–1000 is refused", () => {
    assert.throws(() => step(curve, BLUE, "1200"), /stop must be a number 0–1000/);
  });

  test("a swatch is the anchor with one channel moved", () => {
    const params = parseParams(curve, BLUE).values;
    const anchor = lch(parseColor("#3b82f6", "blue"));
    assert.equal(css({ color: curve.curveSwatch!(params, "hue", 0) }), "#3b82f6");
    const turned = lch(curve.curveSwatch!(params, "hue", 40));
    assert.ok(near(turned[2], anchor[2] + 40, 1e-3) && near(turned[0], anchor[0]));
    assert.ok(near(lch(curve.curveSwatch!(params, "lightness", 0.3))[0], 0.3));
  });

  test("a curve param must run along a number field of its selector", () => {
    const wrong = { ...curve, name: "wrong", params: { ...curve.params, hue: { ...curve.params.hue, along: "nope" } } };
    assert.throws(
      () => resolveDefinition(`
dtg: 1
systems:
  blue: { algorithm: wrong, params: { anchor: "#3b82f6" }, emit: [500] }
`, [wrong as typeof curve]),
      /wrong param "hue" runs along "nope", which is not a number field of its selector/,
    );
  });

  test("a system reports each curve filled in, with where it passes through the anchor", () => {
    const [system] = resolveDefinition(`
dtg: 1
systems:
  blue:
    algorithm: curve
    params: { anchor: "#3b82f6", hue: { to: 10 } }
    emit: [500]
`).systems;
    assert.deepEqual(Object.keys(system.params), Object.keys(curve.params));
    assert.deepEqual(system.ownParams, ["anchor", "hue"]);
    assert.ok(system.defaultedParams.includes("lightness") && !system.defaultedParams.includes("hue"));
    assert.deepEqual(system.curves.hue.value, { from: 0, to: 10, easing: [[0.33, 0.33, 0.67, 0.67], [0.33, 0.33, 0.67, 0.67]] });
    assert.deepEqual(system.curves.hue.pivot, { at: 500, value: 0 });
    assert.deepEqual(system.curves.hue.span, { min: 0, max: 1000 });
    assert.equal(system.curves.lightness.samples.length, 41);
    assert.equal(css({ color: system.curves.lightness.samples[20].color }), "#3b82f6");
    assert.deepEqual(system.curves.lightness.marks.map((mark) => [mark.at, mark.step]), [[500, "500"]]);
    assert.equal(system.curves.hue.label, "degrees from the anchor's hue");
    assert.equal(system.curves.hue.unit, "°");
    assert.equal(system.curves.lightness.unit, null);
    assert.equal(system.curves.hue.swatches.length, 121);
    assert.deepEqual([system.curves.hue.swatches[0].value, system.curves.hue.swatches[120].value], [-180, 180]);
    assert.ok(near(system.curves.lightness.pivot.value, lch(parseColor("#3b82f6", "blue"))[0]));
  });
});
