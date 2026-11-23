import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolveDefinition } from "../dist/resolve.js";
import { emitCss } from "../dist/emit.js";
import { applyEdits, readValue } from "../dist/edit.js";
import { changesOf, openFile, withSpellingsOffered, workingText } from "../dist/working-copy.js";

const SRC = `dtg: 1
palette:
  white: "#ffffff"
  hues:
    publish: false
    sky: "#03a2e8"
systems:
  theme:
    algorithm: scale
    params: { base: hues.sky, toward: ["#ffffff", "#000000"] }
    publish: [50, 900]
roles:
  surface: { canvas: theme(250) }
`;

describe("publish", () => {
  const css = emitCss(resolveDefinition(SRC), "css");

  test("false on a palette group keeps its colors as inputs", () => {
    assert.ok(!css.includes("--hues-sky"));
    assert.ok(css.includes("--white: #ffffff;"));
  });

  test("on a system lists steps published besides what refs demand", () => {
    assert.deepEqual(
      resolveDefinition(SRC).systems[0].steps.map((step) => step.selector),
      ["50", "250", "900"],
    );
  });

  test("emit, its earlier spelling, means the same", () => {
    assert.equal(emitCss(resolveDefinition(SRC.replaceAll("publish:", "emit:")), "css"), css);
  });

  test("written beside emit is an error", () => {
    assert.throws(
      () => resolveDefinition(SRC.replace("    publish: [50, 900]", "    publish: [50, 900]\n    emit: [50]")),
      /system "theme": `emit` is the earlier spelling of `publish` — write one of them/,
    );
    assert.throws(
      () => resolveDefinition(SRC.replace("    publish: false", "    publish: false\n    emit: false")),
      /palette "hues": `emit` is the earlier spelling of `publish`/,
    );
  });
});

describe("the editor's offer to write emit as publish", () => {
  const EARLIER = `dtg: 1
palette:
  white: "#ffffff"
  hues:
    emit: false # inputs only
    sky: "#03a2e8"
systems:
  theme:
    algorithm: scale
    params: { base: hues.sky, toward: ["#ffffff", "#000000"] }
    emit: [50, 900]
  both:
    algorithm: tint
    params: { base: white, tint: hues.sky }
roles:
  surface: { canvas: theme(250), emit: both(3) }
`;
  const spelling = { kind: "spelling", key: "publish" } as const;

  test("reads the earlier spelling while any block writes it", () => {
    assert.equal(readValue(EARLIER, spelling), "emit");
    assert.equal(readValue(SRC, spelling), "publish");
  });

  test("rewrites only the keys, leaving values and comments", () => {
    const text = applyEdits(EARLIER, [{ action: "set", target: spelling, value: "publish" }]);
    assert.equal(text, EARLIER.replace("    emit: false # inputs only", "    publish: false # inputs only").replace("    emit: [50, 900]", "    publish: [50, 900]"));
  });

  test("is offered as one change when the file has emit", () => {
    const copy = withSpellingsOffered(openFile(EARLIER));
    assert.deepEqual(changesOf(copy), [{ action: "set", target: spelling, from: "emit", to: "publish" }]);
    assert.equal(readValue(workingText(copy).text, spelling), "publish");
  });

  test("is not offered when the file has none", () => {
    assert.deepEqual(withSpellingsOffered(openFile(SRC)).steps, []);
  });

  test("is not offered twice", () => {
    const copy = withSpellingsOffered(openFile(EARLIER));
    assert.equal(withSpellingsOffered(copy).steps.length, 1);
  });
});
