import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { hexToOklab, inGamut, oklabToOklch } from "../dist/color-math.js";
import { addToPalette, harmonizePalette, rollPalette, type RollColor } from "../dist/palette-roll.js";

/** A repeatable stand-in for Math.random. */
function seeded(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const color = (path: string, hex: string, locked = false): RollColor => ({ path, lab: hexToOklab(hex), locked });
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const PALETTE = [color("a", "#03a2e8", true), color("b", "#fead3c"), color("c", "#0e9d51"), color("d", "#c50101")];

describe("rolling a palette", () => {
  test("anything rolls every unlocked color, the named base too", () => {
    assert.deepEqual([...rollPalette(PALETTE, "anything", "b", seeded()).keys()], ["b", "c", "d"]);
  });

  test("tone leaves locked colors and the base, and gives the rest the base's lightness", () => {
    const rolled = rollPalette(PALETTE, "tone", "b", seeded());
    assert.deepEqual([...rolled.keys()], ["c", "d"]);
    const [baseL, baseC] = oklabToOklch(PALETTE[1].lab);
    for (const lab of rolled.values()) {
      const [L, C] = oklabToOklch(lab);
      assert.ok(Math.abs(L - baseL) < 1e-9);
      assert.ok(C <= baseC + 1e-9);
    }
  });

  test("with no base named, the first locked color is the base", () => {
    const baseL = oklabToOklch(PALETTE[0].lab)[0];
    for (const lab of rollPalette(PALETTE, "tone", null, seeded()).values()) assert.ok(Math.abs(oklabToOklch(lab)[0] - baseL) < 1e-9);
  });

  test("an added color follows the style", () => {
    const baseL = oklabToOklch(PALETTE[0].lab)[0];
    assert.ok(Math.abs(oklabToOklch(addToPalette(PALETTE, "tone", null, seeded()))[0] - baseL) < 1e-9);
    assert.ok(inGamut(addToPalette(PALETTE, "anything", null, seeded()), "srgb", 1e-4));
    assert.ok(inGamut(addToPalette([], "tone", null, seeded()), "srgb", 1e-4));
  });

  test("every rolled color fits hex", () => {
    for (const style of ["anything", "tone"] as const) {
      for (const lab of rollPalette(PALETTE, style, null, seeded(7)).values()) assert.ok(inGamut(lab, "srgb", 1e-4), style);
    }
  });
});

describe("harmonizing a palette", () => {
  test("triad places hues a third of the wheel from the base, keeping each color's lightness", () => {
    const baseHue = oklabToOklch(PALETTE[0].lab)[2];
    const moved = harmonizePalette(PALETTE, "triad", "a");
    assert.deepEqual([...moved.keys()], ["b", "c", "d"]);
    const places = [baseHue + 120, baseHue + 240, baseHue];
    [...moved.values()].forEach((lab, index) => {
      const [L, , H] = oklabToOklch(lab);
      assert.ok(hueGap(H, places[index]) < 0.5);
      assert.ok(Math.abs(L - oklabToOklch(PALETTE[index + 1].lab)[0]) < 1e-9);
    });
  });

  test("even splits the widest gaps between fixed hues", () => {
    const baseHue = oklabToOklch(PALETTE[0].lab)[2];
    const hues = [...harmonizePalette(PALETTE.slice(0, 3), "even", null).values()].map((lab) => oklabToOklch(lab)[2]);
    assert.ok(hueGap(hues[0], baseHue + 120) < 0.5);
    assert.ok(hueGap(hues[1], baseHue + 240) < 0.5);
  });

  test("even counts two fixed colors of one hue as one place on the wheel", () => {
    const twin = [PALETTE[0], { ...PALETTE[0], path: "twin" }, { ...PALETTE[1], locked: false }, { ...PALETTE[2], locked: false }].map((entry, index) => ({ ...entry, locked: index < 2 }));
    const baseHue = oklabToOklch(PALETTE[0].lab)[2];
    const hues = [...harmonizePalette(twin, "even", null).values()].map((lab) => oklabToOklch(lab)[2]);
    assert.equal(hues.length, 2);
    assert.ok(hueGap(hues[0], baseHue + 120) < 0.5);
    assert.ok(hueGap(hues[1], baseHue + 240) < 0.5);
  });

  test("applying a harmony twice changes nothing the second time", () => {
    const once = harmonizePalette(PALETTE, "analogous", null);
    const after = PALETTE.map((entry) => ({ ...entry, lab: once.get(entry.path) ?? entry.lab }));
    assert.equal(harmonizePalette(after, "analogous", null).size, 0);
  });

  test("with nothing locked or named, the first color is the base", () => {
    const loose = PALETTE.map((entry) => ({ ...entry, locked: false }));
    assert.deepEqual([...harmonizePalette(loose, "complementary", null).keys()], ["b", "c", "d"]);
  });
});
