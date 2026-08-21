import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  alphaComposite,
  assertHex,
  hexToRgb,
  oklabDeltaE,
  rgbToHex,
} from "../dist/color-math.js";

describe("color math", () => {
  test("hex round-trips through rgb", () => {
    for (const hex of ["#000000", "#ffffff", "#ff8000", "#001a28"]) {
      assert.equal(rgbToHex(hexToRgb(hex)), hex);
    }
  });
  test("assertHex rejects anything that is not a 6-digit hex", () => {
    for (const bad of ["#fff", "ff8000", "#gggggg", 123, null, undefined]) {
      assert.throws(() => assertHex(bad, "ctx"), /expected a 6-digit hex/);
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
  test("deltaE is zero for a color against itself and symmetric otherwise", () => {
    assert.equal(oklabDeltaE("#3366cc", "#3366cc"), 0);
    const a = oklabDeltaE("#000000", "#ffffff");
    const b = oklabDeltaE("#ffffff", "#000000");
    assert.ok(Math.abs(a - b) < 1e-12);
    assert.ok(a > 0);
  });
});
