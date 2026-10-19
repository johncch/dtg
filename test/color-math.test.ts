import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  alphaComposite,
  composite,
  convert,
  formatAuthored,
  formatColor,
  hexToRgb,
  NO_HUE_BELOW_CHROMA,
  parseColor,
  toOklab,
  oklabDeltaE,
  rgbToHex,
} from "../dist/color-math.js";

describe("color math", () => {
  test("hex round-trips through rgb", () => {
    for (const hex of ["#000000", "#ffffff", "#ff8000", "#001a28"]) {
      assert.equal(rgbToHex(hexToRgb(hex)), hex);
    }
  });

  test("alphaComposite endpoints are the ground and the layer", () => {
    const ink = hexToRgb("#001a28");
    const base = hexToRgb("#fafdff");
    assert.equal(rgbToHex(alphaComposite(ink, base, 0)), "#fafdff");
    assert.equal(rgbToHex(alphaComposite(ink, base, 1)), "#001a28");
  });
  test("alphaComposite matches the shipped fifthrevision anchors", () => {
    // #b30a0a at 6% over white is $lightWarm-c1 in _theme.scss.
    const got = rgbToHex(
      alphaComposite(hexToRgb("#b30a0a"), hexToRgb("#ffffff"), 0.06),
    );
    assert.equal(got, "#faf0f0");
  });
  test("the no-hue threshold sits between hex gray noise and the least colorful hex", () => {
    let grayNoise = 0;
    for (let v = 0; v < 256; v++) {
      const [, a, b] = toOklab(parseColor(rgbToHex([v, v, v]), "gray"));
      grayNoise = Math.max(grayNoise, Math.hypot(a, b));
    }
    const [, a, b] = toOklab(parseColor("#feffff", "near gray"));
    assert.ok(grayNoise < NO_HUE_BELOW_CHROMA);
    assert.ok(Math.hypot(a, b) > NO_HUE_BELOW_CHROMA);
  });
  test("a gray is written back with hue 0, whatever hue it was written with", () => {
    const lab = toOklab(parseColor("oklch(0.7 0 200)", "ctx"));
    assert.equal(formatAuthored(lab, 0.5), "oklch(0.7 0 0 / 0.5)");
  });
  test("the mix space decides what 50% black over white is", () => {
    const black = parseColor("#000000", "black");
    const white = parseColor("#ffffff", "white");
    const at = (space: "srgb" | "linear" | "oklab") => formatColor(composite(black, white, 0.5, space), "srgb");
    assert.equal(at("srgb"), "#808080");
    assert.equal(at("linear"), "#bcbcbc");
    assert.equal(at("oklab"), "#636363");
  });
  test("in linear light, sRGB and P3 numbers mix to the same color", () => {
    const red = parseColor("#ff0000", "red");
    const sameRedInP3 = convert(red, "display-p3");
    const white = parseColor("#ffffff", "white");
    assert.equal(
      formatColor(composite(red, white, 0.1, "linear"), "srgb"),
      formatColor(composite(sameRedInP3, white, 0.1, "linear"), "srgb"),
    );
  });
  test("encoded sRGB and encoded P3 disagree on a colorful mix", () => {
    const p3Red = parseColor("color(display-p3 1 0 0)", "p3 red");
    const white = parseColor("#ffffff", "white");
    assert.equal(formatColor(composite(p3Red, white, 0.6, "display-p3"), "display-p3"), "color(display-p3 1 0.4 0.4)");
    assert.equal(formatColor(composite(p3Red, white, 0.6, "srgb"), "display-p3"), "color(display-p3 0.9736 0.336 0.3401)");
  });
  test("deltaE is zero for a color against itself and symmetric otherwise", () => {
    assert.equal(oklabDeltaE("#3366cc", "#3366cc"), 0);
    const a = oklabDeltaE("#000000", "#ffffff");
    const b = oklabDeltaE("#ffffff", "#000000");
    assert.ok(Math.abs(a - b) < 1e-12);
    assert.ok(a > 0);
  });
});

describe("parseColor", () => {
  const srgb = (v: unknown) => formatColor(parseColor(v, "ctx"), "srgb");

  test("hex, long and short", () => {
    assert.equal(srgb("#ff8000"), "#ff8000");
    assert.equal(srgb("#FF8000"), "#ff8000");
    assert.equal(srgb("#f80"), "#ff8800");
  });

  test("a color keeps the space it was authored in", () => {
    assert.equal(parseColor("#ff8000", "ctx").space, "srgb");
    assert.equal(parseColor("oklch(0.7 0.15 40)", "ctx").space, "oklab");
    assert.equal(parseColor("oklab(0.7 0.1 0.1)", "ctx").space, "oklab");
    assert.equal(parseColor("color(display-p3 1 0 0)", "ctx").space, "display-p3");
    assert.equal(parseColor("color(srgb 1 0 0)", "ctx").space, "srgb");
  });

  test("color(srgb 1 .5 0) and its hex are the same color", () => {
    assert.equal(srgb("color(srgb 1 0.5 0)"), "#ff8000");
  });

  test("P3 red is outside sRGB, so it is not sRGB red", () => {
    const p3 = parseColor("color(display-p3 1 0 0)", "ctx");
    assert.notEqual(formatColor(p3, "srgb"), "#ff0000");
    assert.equal(formatColor(p3, "display-p3"), "color(display-p3 1 0 0)");
  });

  test("oklch and oklab name the same color", () => {
    const a = toOklab(parseColor("oklch(0.7 0.1 90)", "ctx"));
    const b = toOklab(parseColor("oklab(0.7 0 0.1)", "ctx"));
    a.forEach((c, i) => assert.ok(Math.abs(c - b[i]) < 1e-12));
  });

  test("percentages and deg are accepted where CSS accepts them", () => {
    assert.equal(srgb("oklch(70% 0.1 40deg)"), srgb("oklch(0.7 0.1 40)"));
    assert.equal(srgb("color(display-p3 100% 50% 0%)"), srgb("color(display-p3 1 0.5 0)"));
  });

  test("alpha rides along, in either notation", () => {
    assert.equal(parseColor("#ff8000", "ctx").alpha, 1);
    assert.equal(parseColor("color(srgb 1 0.5 0 / 0.4)", "ctx").alpha, 0.4);
    assert.equal(parseColor("oklch(0.7 0.1 40 / 40%)", "ctx").alpha, 0.4);
  });

  test("none reads as 0 in any slot, as Tailwind writes its grays", () => {
    assert.equal(srgb("oklch(98.5% 0 none)"), srgb("oklch(98.5% 0 0)"));
    assert.equal(srgb("oklab(0.7 none none)"), srgb("oklab(0.7 0 0)"));
    assert.equal(srgb("color(display-p3 1 none 0)"), srgb("color(display-p3 1 0 0)"));
    assert.equal(parseColor("oklch(0.5 0.1 200 / none)", "ctx").alpha, 0);
  });

  test("rejects what it cannot read, naming the context", () => {
    for (const bad of ["ff8000", "#gggggg", "rgb(1,2,3)", "oklch(0.7 0.1)", "color(rec2020 1 0 0)", 123, null, undefined]) {
      assert.throws(() => parseColor(bad, "some param"), /some param/);
    }
  });
});
