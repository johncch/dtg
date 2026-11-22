import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, readValue } from "../dist/edit.js";
import { resolveDefinition } from "../dist/resolve.js";
import { changesOf, openFile, withEdit, withEdits } from "../dist/working-copy.js";
import { overridesAfterChanges } from "../dist/dev-settings.js";

const LISTED = `dtg: 1
modes: [light, dark]
palette:
  paper: "#ffffff"
  ink: "#313133"
semantic:
  surface: [paper, ink]
`;

const MAPPED = `dtg: 1
modes:
  light:
    scheme: light
  dark:
    scheme: dark
  black:
    extends: dark
palette:
  paper: "#ffffff"
  ink: "#313133"
semantic:
  surface: [paper, ink]
`;

const dim = { kind: "mode", name: "dim" } as const;

describe("a mode", () => {
  test("added to a list of modes writes the list as a map first", () => {
    const text = applyEdits(LISTED, [{ action: "add", target: dim, value: "extends dark" }]);
    assert.equal(
      text,
      `dtg: 1
modes:
  light:
  dark:
  dim:
    extends: dark
palette:
  paper: "#ffffff"
  ink: "#313133"
semantic:
  surface: [paper, ink]
`,
    );
    assert.deepEqual(resolveDefinition(text).modes, ["light", "dark", "dim"]);
  });

  test("added to a map goes at its end, extending the mode named", () => {
    const text = applyEdits(MAPPED, [{ action: "add", target: dim, value: "extends light" }]);
    assert.match(text, /  black:\n    extends: dark\n  dim:\n    extends: light\npalette:/);
    const resolved = resolveDefinition(text);
    assert.equal(resolved.modeDetails.at(-1)!.scheme, "light");
  });

  test("cannot be added twice, or extend a mode there is none of", () => {
    assert.throws(() => applyEdits(MAPPED, [{ action: "add", target: { kind: "mode", name: "black" }, value: "extends dark" }]));
    assert.throws(() => applyEdits(MAPPED, [{ action: "add", target: dim, value: "extends sepia" }]));
  });

  test("renamed takes every extends naming it along", () => {
    const text = applyEdits(MAPPED, [{ action: "rename", target: { kind: "mode", name: "dark" }, name: "night" }]);
    assert.match(text, /  night:\n    scheme: dark\n  black:\n    extends: night\n/);
    assert.deepEqual(resolveDefinition(text).modes, ["light", "night", "black"]);
  });

  test("renamed in a list stays a list", () => {
    const text = applyEdits(LISTED, [{ action: "rename", target: { kind: "mode", name: "light" }, name: "day" }]);
    assert.match(text, /modes: \[day, dark\]/);
  });

  test("cannot be renamed to a mode there is already", () => {
    assert.throws(() => applyEdits(MAPPED, [{ action: "rename", target: { kind: "mode", name: "black" }, name: "light" }]));
  });

  test("reads as the mode it extends, empty for a root", () => {
    assert.equal(readValue(MAPPED, { kind: "mode", name: "black" }), "extends dark");
    assert.equal(readValue(MAPPED, { kind: "mode", name: "light" }), "");
    assert.equal(readValue(MAPPED, dim), null);
  });
});

describe("a mode added as a copy", () => {
  const copied = [
    { action: "add", target: dim, value: "copy of dark" },
    { action: "set", target: { kind: "ref", section: "semantic", role: "surface", mode: 3 }, value: "ink" },
  ] as const;

  test("is a root, with the refs its step sets", () => {
    const text = applyEdits(MAPPED, [...copied]);
    assert.match(text, /  black:\n    extends: dark\n  dim:\npalette:/);
    assert.match(text, /surface: \[paper, ink, ~, ink\]/);
    const resolved = resolveDefinition(text);
    assert.equal(resolved.modeDetails.at(-1)!.extends, undefined);
  });

  test("is one change, its refs part of it", () => {
    assert.deepEqual(changesOf(withEdits(openFile(MAPPED), [...copied])), [{ action: "set", target: dim, from: null, to: "copy of dark" }]);
  });
});

describe("a mode added to a definition without modes", () => {
  const MODELESS = `dtg: 1
palette:
  paper: "#ffffff"
  ink: "#313133"
semantic:
  surface: paper
  text:
    refs: ink
    description: Body copy.
  alias: base
`;

  test("names the implicit mode and writes every bare ref as a list", () => {
    const text = applyEdits(MODELESS, [{ action: "add", target: dim, value: "extends default" }]);
    assert.equal(
      text,
      `dtg: 1
modes:
  default:
  dim:
    extends: default
palette:
  paper: "#ffffff"
  ink: "#313133"
semantic:
  surface: [paper]
  text:
    refs: [ink]
    description: Body copy.
  alias: base
`,
    );
    assert.deepEqual(resolveDefinition(text).modes, ["default", "dim"]);
  });

  test("as a copy takes a second ref on each role", () => {
    const text = applyEdits(MODELESS, [
      { action: "add", target: dim, value: "copy of default" },
      { action: "set", target: { kind: "ref", section: "semantic", role: "surface", mode: 1 }, value: "paper" },
      { action: "set", target: { kind: "ref", section: "semantic", role: "text", mode: 1 }, value: "ink" },
    ]);
    assert.match(text, /surface: \[paper, paper\]/);
    assert.match(text, /refs: \[ink, ink\]/);
    assert.deepEqual(resolveDefinition(text).problems, []);
  });
});

describe("a mode removed", () => {
  const THREE = `dtg: 1
modes:
  light:
    scheme: light
  dim:
  dark:
    scheme: dark
palette:
  paper: "#ffffff"
  ink: "#313133"
semantic:
  surface: [paper, paper, ink]
  text:
    refs:
      - ink
      - ink
      - paper
`;

  test("takes its place out of every ref list", () => {
    const text = applyEdits(THREE, [{ action: "remove", target: dim }]);
    assert.equal(
      text,
      `dtg: 1
modes:
  light:
    scheme: light
  dark:
    scheme: dark
palette:
  paper: "#ffffff"
  ink: "#313133"
semantic:
  surface: [paper, ink]
  text:
    refs:
      - ink
      - paper
`,
    );
    assert.deepEqual(resolveDefinition(text).problems, []);
  });

  test("from a list stays a list", () => {
    assert.match(applyEdits(LISTED, [{ action: "remove", target: { kind: "mode", name: "light" } }]), /modes: \[dark\]\n[^]*surface: \[ink\]/);
  });

  test("past the end of a short ref list leaves it be", () => {
    const text = applyEdits(MAPPED, [{ action: "remove", target: { kind: "mode", name: "black" } }]);
    assert.match(text, /surface: \[paper, ink\]/);
    assert.doesNotMatch(text, /black/);
  });

  test("stays while another mode extends it, or it is the only one", () => {
    assert.throws(() => applyEdits(MAPPED, [{ action: "remove", target: { kind: "mode", name: "dark" } }]), /extended by black/);
    assert.throws(() => applyEdits(`dtg: 1\nmodes: [solo]\nsemantic:\n  a: [b]\n`, [{ action: "remove", target: { kind: "mode", name: "solo" } }]), /only mode/);
  });

  test("is one change; refs set in it go with it, and those after it keep their place", () => {
    const copy = withEdits(openFile(THREE), [
      { action: "set", target: { kind: "ref", section: "semantic", role: "surface", mode: 1 }, value: "ink" },
      { action: "set", target: { kind: "ref", section: "semantic", role: "surface", mode: 2 }, value: "paper" },
      { action: "remove", target: dim },
      { action: "set", target: { kind: "ref", section: "semantic", role: "text", mode: 1 }, value: "ink" },
    ]);
    assert.deepEqual(changesOf(copy), [
      { action: "set", target: { kind: "ref", section: "semantic", role: "surface", mode: 1 }, from: "ink", to: "paper" },
      { action: "remove", target: dim, from: "" },
      { action: "set", target: { kind: "ref", section: "semantic", role: "text", mode: 1 }, from: "paper", to: "ink" },
    ]);
  });

  test("leaves no background behind", () => {
    const copy = withEdit(openFile(THREE), { action: "remove", target: dim });
    assert.deepEqual(overridesAfterChanges({ dim: "#888888", dark: "#000000" }, changesOf(copy)), { dark: "#000000" });
  });
});

describe("a mode's scheme", () => {
  test("is written over where the mode has one", () => {
    const text = applyEdits(MAPPED, [{ action: "set", target: { kind: "scheme", mode: "light" }, value: "dark" }]);
    assert.match(text, /  light:\n    scheme: dark\n/);
  });

  test("is added to a mode that writes none", () => {
    const text = applyEdits(MAPPED, [{ action: "set", target: { kind: "scheme", mode: "black" }, value: "light" }]);
    assert.match(text, /  black:\n    extends: dark\n    scheme: light\n/);
  });

  test("is added to a mode written as a list", () => {
    const text = applyEdits(LISTED, [{ action: "set", target: { kind: "scheme", mode: "dark" }, value: "dark" }]);
    assert.match(text, /modes:\n  light:\n  dark:\n    scheme: dark\npalette:/);
    assert.equal(resolveDefinition(text).modeDetails[1].scheme, "dark");
  });

  test("set empty is taken out, leaving the mode", () => {
    const text = applyEdits(MAPPED, [{ action: "set", target: { kind: "scheme", mode: "light" }, value: "" }]);
    assert.match(text, /modes:\n  light: \{\}\n  dark:\n/);
    assert.deepEqual(resolveDefinition(text).modes, ["light", "dark", "black"]);
  });

  test("reads as written, empty when the mode writes none", () => {
    assert.equal(readValue(MAPPED, { kind: "scheme", mode: "dark" }), "dark");
    assert.equal(readValue(MAPPED, { kind: "scheme", mode: "black" }), "");
  });
});

describe("mode changes", () => {
  test("an added mode is one change, its scheme with it", () => {
    const copy = withEdits(openFile(MAPPED), [
      { action: "add", target: dim, value: "extends dark" },
      { action: "set", target: { kind: "scheme", mode: "dim" }, value: "light" },
    ]);
    assert.deepEqual(changesOf(copy), [
      { action: "set", target: dim, from: null, to: "extends dark" },
      { action: "set", target: { kind: "scheme", mode: "dim" }, from: null, to: "light" },
    ]);
  });

  test("a scheme set on a renamed mode is the file's mode's scheme", () => {
    const copy = withEdits(openFile(MAPPED), [
      { action: "rename", target: { kind: "mode", name: "black" }, name: "oled" },
      { action: "set", target: { kind: "scheme", mode: "oled" }, value: "dark" },
    ]);
    assert.deepEqual(changesOf(copy), [
      { action: "rename", target: { kind: "mode", name: "black" }, to: { kind: "mode", name: "oled" } },
      { action: "set", target: { kind: "scheme", mode: "oled" }, from: "", to: "dark" },
    ]);
  });

  test("a scheme set back to the file's is no change", () => {
    const copy = withEdit(withEdit(openFile(MAPPED), { action: "set", target: { kind: "scheme", mode: "black" }, value: "light" }), {
      action: "set",
      target: { kind: "scheme", mode: "black" },
      value: "",
    });
    assert.deepEqual(changesOf(copy), []);
  });

  test("a renamed mode's background follows it", () => {
    const copy = withEdit(openFile(MAPPED), { action: "rename", target: { kind: "mode", name: "black" }, name: "oled" });
    assert.deepEqual(overridesAfterChanges({ black: "#000000", light: "#fafafa" }, changesOf(copy)), { oled: "#000000", light: "#fafafa" });
  });
});
