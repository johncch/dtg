import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { algorithmFor } from "../dist/resolve.js";

const inkRamp = algorithmFor("ink-ramp")!;
const blend = algorithmFor("blend")!;
const overlay = algorithmFor("overlay")!;

const SKY = { base: "#fafdff", ink: "#001a28" };
const WARM = { base: "#ffffff", toward: { red: "#b30a0a", blue: "#6192bb" } };









describe("ink-ramp", () => {
  test("composites; /ink returns the layer instead", () => {
    assert.deepEqual(inkRamp.resolveStep(SKY, "3"), {
      css: "#f3f6f9",
      opaque: true,
    });
    assert.deepEqual(inkRamp.resolveStep(SKY, "3/ink"), {
      css: "rgba(0, 26, 40, 0.03)",
      opaque: false,
    });
  });
  test("public names survive a fractional alpha", () => {
    // Regression: deriving the name from the parsed float produced
    // "3_5000000000000004" because parseAlpha divides by 100.
    assert.equal(inkRamp.publicStep!(SKY, "3.5"), "3_5");
    assert.equal(inkRamp.publicStep!(SKY, "3.5/ink"), "3_5-ink");
    assert.equal(inkRamp.publicStep!(SKY, "15"), "15");
  });
  test("rejects bad selectors with a pointed message", () => {
    assert.throws(() => inkRamp.resolveStep(SKY, "140"), /0–100|0-100/);
    assert.throws(() => inkRamp.resolveStep(SKY, "3/raw"), /unknown form "raw"/);
    assert.throws(() => inkRamp.resolveStep(SKY, "abc"), /must be a number/);
  });
});

describe("blend", () => {
  test("blends toward a named colour; /alpha defers to the browser", () => {
    assert.deepEqual(blend.resolveStep(WARM, "red@6"), {
      css: "#faf0f0",
      opaque: true,
    });
    assert.deepEqual(blend.resolveStep(WARM, "red@6/alpha"), {
      css: "rgba(179, 10, 10, 0.06)",
      opaque: false,
    });
    assert.equal(blend.resolveStep(WARM, "red@100").css, "#b30a0a");
  });
  test("selectors need a weight and a known colour", () => {
    assert.throws(() => blend.resolveStep(WARM, "red"), /needs a weight/);
    assert.throws(() => blend.resolveStep(WARM, "green@6"), /unknown colour/);
    assert.throws(() => blend.resolveStep(WARM, "red@"), /must be a number/);
    assert.throws(() => blend.resolveStep(WARM, "red@6/x"), /unknown form "x"/);
  });
  test("orders by declaration, then weight, then form", () => {
    const order = ["blue@6", "red@100", "red@6", "red@6/alpha"]
      .map((s) => [s, blend.stepOrder!(WARM, s)] as const)
      .sort((a, b) => (a[1] < b[1] ? -1 : 1))
      .map(([s]) => s);
    assert.deepEqual(order, ["red@6", "red@6/alpha", "red@100", "blue@6"]);
  });
});

describe("overlay", () => {
  test("never composites, so it has no uncomposited form", () => {
    assert.deepEqual(overlay.resolveStep({ color: "#000000" }, "40"), {
      css: "rgba(0, 0, 0, 0.4)",
      opaque: false,
    });
    // There is no ground to drop, so the selector form other algorithms
    // publish simply is not part of overlay's vocabulary.
    assert.throws(
      () => overlay.resolveStep({ color: "#000000" }, "40/ink"),
      /must be a number/,
    );
  });
});

describe("params", () => {
  test("reject unknown params rather than ignoring them", () => {
    assert.throws(
      () => inkRamp.declaredSelectors({ ...SKY, tint: 3 }),
      /unknown param "tint"/,
    );
    assert.throws(
      () => blend.declaredSelectors({ ...WARM, weight: 6 }),
      /unknown param "weight"/,
    );
  });
});

describe("blend space", () => {
  const P = { base: "#ffffff", toward: { red: "#b30a0a" } };

  test("defaults to srgb, which is what a browser would render", () => {
    assert.equal(blend.resolveStep(P, "red@6").css, "#faf0f0");
    assert.equal(
      blend.resolveStep({ ...P, space: "srgb" }, "red@6").css,
      "#faf0f0",
    );
  });

  test("each emittable space lands somewhere different", () => {
    const at = (space: string) =>
      blend.resolveStep({ ...P, space }, "red@6").css;
    assert.equal(at("srgb"), "#faf0f0");
    assert.equal(at("srgb-linear"), "#fbf8f8");
    assert.equal(at("oklab"), "#fdf2f0");
  });

  test("display-p3 is refused until emit can ship a fallback", () => {
    // A bare color(display-p3 ...) with no sRGB fallback is dropped whole by
    // a browser that cannot parse it, taking the custom property with it.
    assert.throws(
      () => blend.declaredSelectors({ ...P, space: "display-p3" }),
      /not emittable yet/,
    );
  });

  test("endpoints agree in every space", () => {
    for (const space of ["srgb", "srgb-linear", "oklab"]) {
      assert.equal(blend.resolveStep({ ...P, space }, "red@100").css, "#b30a0a");
      assert.equal(blend.resolveStep({ ...P, space }, "red@0").css, "#ffffff");
    }
  });

  test("an unknown space is rejected", () => {
    assert.throws(
      () => blend.declaredSelectors({ ...P, space: "cmyk" }),
      /expected one of srgb, srgb-linear, oklab/,
    );
  });

  test("/alpha is refused unless the system blends in srgb", () => {
    // The browser blends a translucent value in srgb, so deferring the blend
    // from an oklab system would silently disagree with its flattened steps.
    assert.equal(
      blend.resolveStep(P, "red@6/alpha").css,
      "rgba(179, 10, 10, 0.06)",
    );
    assert.throws(
      () => blend.resolveStep({ ...P, space: "oklab" }, "red@6/alpha"),
      /always blends in srgb/,
    );
  });
});
