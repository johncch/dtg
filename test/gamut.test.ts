import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { algorithmFor } from "../dist/resolve.js";
import {
  encodeIn,
  formatIn,
  gamutMap,
  hexToOklab,
  inGamut,
  maxChroma,
  formatColor,
  oklabToOklch,
  oklchToOklab,
  translucent,
} from "../dist/color-math.js";

describe("gamut", () => {
  test("every sRGB colour is in the sRGB gamut and in P3", () => {
    for (const hex of ["#000000", "#ffffff", "#b30a0a", "#49beff", "#c9ff55"]) {
      const lab = hexToOklab(hex);
      assert.ok(inGamut(lab, "srgb"), `${hex} srgb`);
      assert.ok(inGamut(lab, "display-p3"), `${hex} p3`);
    }
  });

  test("P3 holds colours sRGB cannot", () => {
    // hue 200 at mid lightness: sRGB tops out well below P3
    const lab = oklchToOklab([0.6, 0.13, 200]);
    assert.equal(inGamut(lab, "srgb"), false);
    assert.equal(inGamut(lab, "display-p3"), true);
  });

  test("P3 has more chroma than sRGB at every hue", () => {
    for (const h of [29, 120, 200, 264, 320]) {
      const s = maxChroma(0.6, h, "srgb");
      const p = maxChroma(0.6, h, "display-p3");
      assert.ok(p > s, `hue ${h}: p3 ${p} should exceed srgb ${s}`);
    }
  });

  test("mapping holds lightness and hue, and only reduces chroma", () => {
    const wanted = oklchToOklab([0.6, 0.3, 200]);
    const mapped = gamutMap(wanted, "srgb");
    const [wL, wC, wH] = oklabToOklch(wanted);
    const [mL, mC, mH] = oklabToOklch(mapped);
    assert.ok(Math.abs(mL - wL) < 1e-9, "lightness held");
    assert.ok(Math.abs(mH - wH) < 1e-6, "hue held");
    assert.ok(mC < wC, "chroma reduced");
    assert.ok(inGamut(mapped, "srgb"), "result fits");
  });

  test("an in-gamut colour is returned untouched", () => {
    const lab = hexToOklab("#6192bb");
    assert.deepEqual(gamutMap(lab, "srgb"), lab);
  });

  test("hex round-trips through OKLab and back", () => {
    for (const hex of ["#000000", "#ffffff", "#808080", "#b30a0a", "#2b66ff"]) {
      assert.equal(formatIn(hexToOklab(hex), "srgb"), hex);
    }
  });

  test("encodeIn reports whether it had to clip", () => {
    const [, clean] = encodeIn(hexToOklab("#b30a0a"), "srgb");
    assert.equal(clean, false);
    const [, clipped] = encodeIn(oklchToOklab([0.6, 0.3, 200]), "srgb");
    assert.equal(clipped, true);
  });

  test("P3 formats as a color() function", () => {
    assert.match(
      formatIn(hexToOklab("#b30a0a"), "display-p3"),
      /^color\(display-p3 [\d. ]+\)$/,
    );
  });
});

describe("translucent", () => {
  test("one formatter, one alpha convention (percent in)", () => {
    assert.equal(translucent([0, 26, 40], 3), "rgba(0, 26, 40, 0.03)");
    assert.equal(translucent([255, 255, 255], 70), "rgba(255, 255, 255, 0.7)");
    assert.equal(translucent([0, 0, 0], 100), "rgba(0, 0, 0, 1)");
  });

  test("channels are rounded and clamped", () => {
    assert.equal(translucent([-3, 127.6, 300], 50), "rgba(0, 128, 255, 0.5)");
  });

  test("every algorithm that emits a translucent value agrees", () => {
    // These three used to format it independently and disagreed about
    // whether alpha arrived as a percent or a fraction.
    const ink = algorithmFor("ink-ramp")!;
    const blend = algorithmFor("blend")!;
    const overlay = algorithmFor("overlay")!;
    const expected = "rgba(0, 26, 40, 0.03)";
    assert.equal(
      formatColor(ink.resolveStep({ base: "#fafdff", ink: "#001a28" }, "3/ink").color, "srgb"),
      expected,
    );
    assert.equal(
      formatColor(blend.resolveStep(
        { base: "#fafdff", toward: { ink: "#001a28" } },
        "ink@3/alpha",
      ).color, "srgb"),
      expected,
    );
    assert.equal(
      formatColor(overlay.resolveStep({ color: "#001a28" }, "3").color, "srgb"),
      expected,
    );
  });
});
