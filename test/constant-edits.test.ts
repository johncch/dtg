import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatColor } from "../dist/color-math.js";
import { applyEdits, readValue } from "../dist/edit.js";
import { resolveDefinition } from "../dist/resolve.js";
import { changesOf, editsOf, openFile, withEdit } from "../dist/working-copy.js";

const SRC = `dtg: 1
palette:
  blue: "#0000ff" # loose
  colors:
    theme: "#03a2e8"
    ruby: "#c50101" # red
  grounds: { paper: "#fafdff", ink: "#001a28" }

systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
`;

const paths = (text: string) => resolveDefinition(text).statics.map((constant) => constant.path);
const constant = (path: string) => ({ kind: "constant", path }) as const;

describe("adding a constant", () => {
  test("setting writes over a constant the file has", () => {
    const edited = applyEdits(SRC, [{ action: "set", target: constant("colors.ruby"), value: "#d01010" }]);
    assert.ok(edited.includes(`    ruby: "#d01010" # red\n`));
  });

  test("adds one a block group does not have, after its last", () => {
    const edited = applyEdits(SRC, [{ action: "add", target: constant("colors.violet"), value: "#7c3aed" }]);
    assert.ok(edited.includes(`    ruby: "#c50101" # red\n    violet: "#7c3aed"\n`));
  });

  test("adds one to a flow group", () => {
    const edited = applyEdits(SRC, [{ action: "add", target: constant("grounds.mist"), value: "#eef2f4" }]);
    assert.ok(edited.includes(`grounds: { paper: "#fafdff", ink: "#001a28", mist: "#eef2f4" }`));
  });

  test("adds one in no group past everything the palette holds, at its indent", () => {
    const edited = applyEdits(SRC, [{ action: "add", target: constant("yellow"), value: "#fead3c" }]);
    assert.ok(edited.includes(`  grounds: { paper: "#fafdff", ink: "#001a28" }\n  yellow: "#fead3c"\n\nsystems:`));
    assert.ok(paths(edited).includes("yellow"));
  });

  test("cannot add to a group the file does not have", () => {
    assert.throws(
      () => applyEdits(SRC, [{ action: "add", target: constant("nope.x"), value: "#000000" }]),
      /nothing written for nope\.x/,
    );
  });

  test("cannot add over anything already written", () => {
    assert.throws(
      () => applyEdits(SRC, [{ action: "add", target: constant("colors"), value: "#000000" }]),
      /colors is already written, and is not a color/,
    );
  });

  test("setting one the file does not have fails, rather than adding it", () => {
    assert.throws(() => applyEdits(SRC, [{ action: "set", target: constant("colors.violet"), value: "#7c3aed" }]));
  });

  test("an added constant is a change from nothing", () => {
    const target = constant("colors.violet");
    assert.equal(readValue(SRC, target), null);
    const copy = withEdit(openFile(SRC), { action: "add", target, value: "#7c3aed" });
    assert.deepEqual(changesOf(copy), [{ action: "set", target, from: null, to: "#7c3aed" }]);
    const added = resolveDefinition(applyEdits(SRC, editsOf(copy))).statics.find((c) => c.path === "colors.violet")!;
    assert.equal(formatColor(added.color, "srgb"), "#7c3aed");
  });
});

const ruby = constant("colors.ruby");
const theme = constant("colors.theme");
const crimson = constant("colors.crimson");

describe("renaming a constant", () => {
  test("rewrites only its key, keeping its value and comment", () => {
    const edited = applyEdits(SRC, [{ action: "rename", target: ruby, name: "crimson" }]);
    assert.equal(edited, SRC.replace("    ruby:", "    crimson:"));
  });

  test("cannot take a name its group already has", () => {
    assert.throws(
      () => applyEdits(SRC, [{ action: "rename", target: ruby, name: "theme" }]),
      /colors\.theme is already written/,
    );
  });

  test("taking a system's name leaves a definition that does not resolve", () => {
    const edited = applyEdits(SRC, [{ action: "rename", target: constant("blue"), name: "sky" }]);
    assert.throws(() => resolveDefinition(edited), /"sky" is both a palette color and a system/);
  });

  test("is one change, and a value set after it is another, both against the file", () => {
    const copy = [
      { action: "rename" as const, target: ruby, name: "crimson" },
      { action: "set" as const, target: crimson, value: "#d01010" },
    ].reduce(withEdit, openFile(SRC));
    assert.deepEqual(changesOf(copy), [
      { action: "rename", target: ruby, to: crimson },
      { action: "set", target: crimson, from: "#c50101", to: "#d01010" },
    ]);
  });

  test("renamed back, it is no change", () => {
    const copy = [
      { action: "rename" as const, target: ruby, name: "crimson" },
      { action: "rename" as const, target: crimson, name: "ruby" },
    ].reduce(withEdit, openFile(SRC));
    assert.deepEqual(changesOf(copy), []);
  });

  test("a new constant under the old name is a new color, not the renamed one", () => {
    const copy = [
      { action: "rename" as const, target: ruby, name: "crimson" },
      { action: "add" as const, target: ruby, value: "#ff0000" },
    ].reduce(withEdit, openFile(SRC));
    assert.deepEqual(changesOf(copy), [
      { action: "rename", target: ruby, to: crimson },
      { action: "set", target: ruby, from: null, to: "#ff0000" },
    ]);
  });
});

describe("removing a constant", () => {
  test("takes its line from a block group", () => {
    const edited = applyEdits(SRC, [{ action: "remove", target: ruby }]);
    assert.equal(edited, SRC.replace('    ruby: "#c50101" # red\n', ""));
  });

  test("takes it from a flow group, first or not", () => {
    assert.ok(applyEdits(SRC, [{ action: "remove", target: constant("grounds.paper") }]).includes(`grounds: { ink: "#001a28" }`));
    assert.ok(applyEdits(SRC, [{ action: "remove", target: constant("grounds.ink") }]).includes(`grounds: { paper: "#fafdff" }`));
  });

  test("leaves an emptied group as {}, still a group to add to", () => {
    const emptied = applyEdits(SRC, [
      { action: "remove", target: ruby },
      { action: "remove", target: theme },
    ]);
    assert.ok(emptied.includes("  colors: {}\n  grounds:"));
    assert.ok(!paths(emptied).some((path) => path.startsWith("colors.")));
    const refilled = applyEdits(emptied, [{ action: "add", target: ruby, value: "#c50101" }]);
    assert.ok(refilled.includes(`colors: { ruby: "#c50101" }`));
  });

  test("is a change, unless the color was added since the file", () => {
    const removed = withEdit(openFile(SRC), { action: "remove", target: ruby });
    assert.deepEqual(changesOf(removed), [{ action: "remove", target: ruby, from: "#c50101" }]);
    const violet = constant("colors.violet");
    const addedAndGone = [
      { action: "add" as const, target: violet, value: "#7c3aed" },
      { action: "remove" as const, target: violet },
    ].reduce(withEdit, openFile(SRC));
    assert.deepEqual(changesOf(addedAndGone), []);
  });
});

const REFERRED = `dtg: 1
modes: [light, dark]
palette:
  hues:
    paper: "#fafdff"
    ink: "#001a28"

systems:
  sky:
    algorithm: tint
    alias: white
    params: { base: hues.paper, tint: "#001a28" }
defaults:
  scale:
    toward: [hues.paper, hues.ink]
core:
  surface:
    canvas: [hues.paper, sky(4)]
    veil: [transparent(hues.paper 70), "transparent(hues.ink 40)"]
changelog:
  - 2026-10-16: hues.paper
`;

describe("a param naming a constant", () => {
  test("takes the constant's color, written above or below it", () => {
    const sky = resolveDefinition(REFERRED).systems.find((system) => system.system === "sky")!;
    const base = sky.colorParams.find((param) => param.path === "base")!;
    assert.equal(base.constant, "hues.paper");
    assert.equal(formatColor(base.color, "srgb"), "#fafdff");
  });

  test("names a constant the file has", () => {
    assert.throws(
      () => resolveDefinition(REFERRED.replace("base: hues.paper", "base: hues.nope")),
      /no constant "hues\.nope"/,
    );
  });
});

describe("renaming a constant something points at", () => {
  test("rewrites every ref, transparent() and param naming it, and nothing else", () => {
    const edited = applyEdits(REFERRED, [{ action: "rename", target: constant("hues.paper"), name: "snow" }]);
    assert.equal(
      edited,
      REFERRED.replace("    paper:", "    snow:")
        .replace("base: hues.paper", "base: hues.snow")
        .replace("toward: [hues.paper,", "toward: [hues.snow,")
        .replace("canvas: [hues.paper,", "canvas: [hues.snow,")
        .replace("transparent(hues.paper 70)", "transparent(hues.snow 70)"),
    );
    assert.doesNotThrow(() => resolveDefinition(edited));
  });

  test("leaves an alias that reads the same alone", () => {
    const flat = `dtg: 1
palette:
  white: "#ffffff"

systems:
  sky:
    algorithm: tint
    alias: white
    params: { base: white, tint: "#001a28" }
`;
    const edited = applyEdits(flat, [{ action: "rename", target: constant("white"), name: "snow" }]);
    assert.ok(edited.includes("alias: white\n"));
    assert.ok(edited.includes("base: snow,"));
  });
});
