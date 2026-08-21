import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { algorithmFor } from "../dist/resolve.js";

const inkRamp = algorithmFor("ink-ramp")!;
const compose = algorithmFor("compose")!;
const overlay = algorithmFor("overlay")!;

const SKY = { base: "#fafdff", ink: "#001a28" };
const WARM = { bottom: "#ffffff", tops: { red: "#b30a0a", blue: "#6192bb" } };









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

describe("compose", () => {
  test("composites a named top; /top returns the layer", () => {
    assert.deepEqual(compose.resolveStep(WARM, "red@6"), {
      css: "#faf0f0",
      opaque: true,
    });
    assert.deepEqual(compose.resolveStep(WARM, "red@6/top"), {
      css: "rgba(179, 10, 10, 0.06)",
      opaque: false,
    });
    assert.equal(compose.resolveStep(WARM, "red@100").css, "#b30a0a");
  });
  test("selectors need a weight and a known top", () => {
    assert.throws(() => compose.resolveStep(WARM, "red"), /needs a weight/);
    assert.throws(() => compose.resolveStep(WARM, "green@6"), /unknown color/);
    assert.throws(() => compose.resolveStep(WARM, "red@"), /must be a number/);
    assert.throws(() => compose.resolveStep(WARM, "red@6/x"), /unknown form "x"/);
  });
  test("orders by declaration, then weight, then form", () => {
    const order = ["blue@6", "red@100", "red@6", "red@6/top"]
      .map((s) => [s, compose.stepOrder!(WARM, s)] as const)
      .sort((a, b) => (a[1] < b[1] ? -1 : 1))
      .map(([s]) => s);
    assert.deepEqual(order, ["red@6", "red@6/top", "red@100", "blue@6"]);
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
      () => compose.declaredSelectors({ ...WARM, weight: 6 }),
      /unknown param "weight"/,
    );
  });
});
