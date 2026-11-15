import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatAuthored, inGamut, parseColor, toOklab, type Color } from "../dist/color-math.js";
import { spreadPalette } from "../dist/palette-spread.js";
import { readValue, type Edit } from "../dist/edit.js";
import { resolveDefinition } from "../dist/resolve.js";
import { openFile, undo, withEdits, workingText } from "../dist/working-copy.js";

const color = (value: string) => parseColor(value, "test");
const entry = (value: string, locked = false) => ({ color: color(value), locked });
const distance = (a: Color, b: Color) => Math.hypot(...toOklab(a).map((value, index) => value - toOklab(b)[index]));
const closest = (colors: Color[], locked: boolean[]) => Math.min(...colors.flatMap((a, index) =>
  colors.slice(index + 1).map((b, offset) => locked[index] && locked[index + 1 + offset] ? Infinity : distance(a, b)),
));

describe("Spread", () => {
  test("separates a cluster from locked anchors and from its unlocked neighbors", () => {
    const entries = [entry("#03a2e8", true), entry("#05a0e5"), entry("#069fe2"), entry("#08a1e4")];
    const before = structuredClone(entries);
    const result = spreadPalette(entries, "srgb");
    assert.strictEqual(result[0], entries[0].color);
    assert.ok(closest(result, entries.map((entry) => entry.locked)) > 0.08);
    for (let index = 0; index < result.length; index++) {
      assert.ok(distance(result[index], entries[index].color) <= 0.12);
      assert.ok(inGamut(toOklab(result[index]), "srgb"));
    }
    assert.deepEqual(entries, before);
    assert.deepEqual(spreadPalette(entries, "srgb"), result);
  });

  test("locked duplicates do not prevent an unlocked color moving away", () => {
    const entries = [entry("#5599bb", true), entry("#5599bb", true), entry("#5599bb")];
    const result = spreadPalette(entries, "srgb");
    assert.strictEqual(result[0], entries[0].color);
    assert.strictEqual(result[1], entries[1].color);
    assert.ok(distance(result[2], result[0]) > 0.1);
  });

  test("handles exact duplicates at the black and white gamut boundaries", () => {
    const entries = [entry("#000000", true), entry("#000000"), entry("#ffffff", true), entry("#ffffff")];
    const result = spreadPalette(entries, "srgb");
    assert.ok(distance(result[0], result[1]) > 0.06);
    assert.ok(distance(result[2], result[3]) > 0.06);
    for (const value of result) assert.ok(inGamut(toOklab(value), "srgb"));
  });

  test("leaves well-separated colors and palettes with no movable pair unchanged", () => {
    const entries = [entry("#03a2e8"), entry("#fead3c"), entry("#0e9d51"), entry("#c50101")];
    const cases = [entries, entries.map((entry) => ({ ...entry, locked: true })), [entries[0]], []];
    for (const input of cases) {
      const result = spreadPalette(input, "display-p3");
      input.forEach((entry, index) => assert.strictEqual(result[index], entry.color));
      assert.equal(result.length, input.length);
    }
  });

  test("keeps wide colors within the project gamut and retains opacity", () => {
    const entries = [entry("color(display-p3 0.2 0.8 0.4 / 0.35)", true), entry("color(display-p3 0.2 0.8 0.4 / 0.35)")];
    const result = spreadPalette(entries, "display-p3");
    assert.ok(distance(result[0], result[1]) > 0.08);
    for (const value of result) {
      assert.ok(inGamut(toOklab(value), "display-p3"));
      assert.equal(value.alpha, 0.35);
    }
  });

  test("never reduces the closest movable pair's distance after authored rounding", () => {
    let seed = 137;
    const byte = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 24).toString(16).padStart(2, "0"); };
    for (let sample = 0; sample < 24; sample++) {
      const entries = Array.from({ length: 8 }, (_, index) => entry(`#${byte()}${byte()}${byte()}`, index < 2));
      const locked = entries.map((entry) => entry.locked);
      const result = spreadPalette(entries, "srgb").map((value) => color(formatAuthored(toOklab(value), value.alpha)));
      assert.ok(closest(result, locked) >= closest(entries.map((entry) => entry.color), locked) - 1e-10);
      result.forEach((value, index) => {
        assert.ok(inGamut(toOklab(value), "srgb"));
        assert.ok(distance(value, entries[index].color) <= 0.12);
      });
    }
  });

  test("spread edits retain constant names and undo as one step", () => {
    const source = `dtg: 1
palette:
  hues:
    anchor: "#5599bb"
    first: "#5599bb"
    second: "#5599bb"
`;
    const constants = resolveDefinition(source).statics;
    const entries = constants.map((constant, index) => ({ color: constant.color, locked: index === 0 }));
    const result = spreadPalette(entries, "srgb");
    const edits: Edit[] = result.flatMap((value, index) => value === entries[index].color ? [] : [{
      action: "set", target: { kind: "constant", path: constants[index].path }, value: formatAuthored(toOklab(value), value.alpha),
    }]);
    assert.equal(edits.length, 2);
    const copy = withEdits(openFile(source), edits);
    const { text, dropped } = workingText(copy);
    assert.deepEqual(dropped, []);
    assert.deepEqual(resolveDefinition(text).statics.map((constant) => constant.path), constants.map((constant) => constant.path));
    assert.equal(readValue(text, { kind: "constant", path: "hues.anchor" }), "#5599bb");
    assert.equal(workingText(undo(copy)).text, source);
  });
});
