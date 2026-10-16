import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, readValue } from "../dist/edit.js";
import { resolveDefinition } from "../dist/resolve.js";
import { formatAuthored, formatColor, oklchToOklab } from "../dist/color-math.js";

const SRC = `# the palette
dtg: 1
modes: [light]
defaults:
  scale:
    toward: ["#ffffff", "#000000"] # shared ends
    hueShift: 0
palette:
  paper: "#ffffff"
  ink:
    body: "#313133" # text

systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
  theme:
    algorithm: scale
    params: { base: "#03a2e8" }
    emit: [500]
roles:
  surface:
    canvas: [sky(3)]
    text: [ink.body]
    accent: [theme(600)]
`;

describe("applyEdits", () => {
  test("writes a constant, a nested constant, a param, and a shared default", () => {
    const edited = applyEdits(SRC, [
      { action: "set", target: { kind: "constant", path: "paper" }, value: "#fffaf0" },
      { action: "set", target: { kind: "constant", path: "ink.body" }, value: "#202022" },
      { action: "set", target: { kind: "param", system: "sky", path: "tint" }, value: "#102a38" },
      { action: "set", target: { kind: "default", algorithm: "scale", path: "toward.1" }, value: "#0a0a0a" },
    ]);
    const resolved = resolveDefinition(edited);
    const constant = (path: string) => formatColor(resolved.statics.find((c) => c.path === path)!.color, "srgb");
    assert.equal(constant("paper"), "#fffaf0");
    assert.equal(constant("ink.body"), "#202022");
    assert.equal(resolved.systems.find((s) => s.system === "sky")!.params.tint, "#102a38");
    assert.deepEqual(resolved.systems.find((s) => s.system === "theme")!.params.toward, ["#ffffff", "#0a0a0a"]);
  });

  test("changes only the line it was asked to", () => {
    const edited = applyEdits(SRC, [
      { action: "set", target: { kind: "constant", path: "ink.body" }, value: "#202022" },
    ]);
    const before = SRC.split("\n");
    const after = edited.split("\n");
    assert.equal(after.length, before.length);
    const changed = after.filter((line, index) => line !== before[index]);
    assert.deepEqual(changed, ['    body: "#202022" # text']);
  });

  test("keeps the quoting the value was written in, and quotes what YAML would misread", () => {
    const quoting = `dtg: 1
palette:
  single: '#111111'
  double: "#222222"
  plain: oklch(0.5 0.1 30)
`;
    const edited = applyEdits(quoting, [
      { action: "set", target: { kind: "constant", path: "single" }, value: "#aaaaaa" },
      { action: "set", target: { kind: "constant", path: "double" }, value: "oklch(0.7 0.26 150)" },
      { action: "set", target: { kind: "constant", path: "plain" }, value: "oklch(0.6 0.2 40)" },
    ]);
    assert.equal(
      edited,
      `dtg: 1
palette:
  single: '#aaaaaa'
  double: "oklch(0.7 0.26 150)"
  plain: oklch(0.6 0.2 40)
`,
    );
    const hexOverPlain = applyEdits(quoting, [
      { action: "set", target: { kind: "constant", path: "plain" }, value: "#333333" },
    ]);
    assert.ok(hexOverPlain.includes('  plain: "#333333"\n'));
    assert.equal(resolveDefinition(hexOverPlain).statics.length, 3);
  });

  test("an edit changes what the system generates", () => {
    const step = (text: string) =>
      formatColor(resolveDefinition(text).systems.find((s) => s.system === "theme")!.steps[0].color, "srgb");
    const edited = applyEdits(SRC, [
      { action: "set", target: { kind: "param", system: "theme", path: "base" }, value: "#e5484d" },
    ]);
    assert.equal(step(edited), "#e5484d");
    assert.notEqual(step(SRC), step(edited));
  });

  test("a target the definition does not have is an error, not a new key", () => {
    assert.throws(
      () => applyEdits(SRC, [{ action: "set", target: { kind: "param", system: "sky", path: "glow" }, value: "#fff" }]),
      /nothing written for sky glow to edit/,
    );
  });
});

describe("formatAuthored", () => {
  test("a color sRGB holds is written as hex", () => {
    assert.equal(formatAuthored(oklchToOklab([0.6256, 0.1933, 23.03])), "#e5484d");
  });

  test("a color outside sRGB is written as oklch()", () => {
    assert.equal(formatAuthored(oklchToOklab([0.7, 0.26, 150])), "oklch(0.7 0.26 150)");
  });

  test("a translucent color is written as oklch() with its alpha, since hex has nowhere to put it", () => {
    assert.equal(formatAuthored(oklchToOklab([0.5, 0.1, 30]), 0.4), "oklch(0.5 0.1 30 / 0.4)");
  });
});

describe("a role's ref", () => {
  const ROLES = `dtg: 1
modes:
  light:
  dark:
  black: { extends: dark }
palette:
  paper: "#ffffff"

systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
roles:
  surface:
    canvas: [sky(3), sky(8), ~] # the page
    card: [sky(1), sky(1)]
  label:
    primary:
      omit: true
      refs: [paper, sky(60)]
`;
  const ref = (role: string, mode: number) => ({ kind: "ref", section: "roles", role, mode }) as const;

  test("is rewritten in a list, and in a block's refs", () => {
    const edited = applyEdits(ROLES, [
      { action: "set", target: ref("surface.canvas", 1), value: "sky(12 tint)" },
      { action: "set", target: ref("label.primary", 0), value: "sky(0)" },
    ]);
    assert.ok(edited.includes("    canvas: [sky(3), sky(12 tint), ~] # the page\n"));
    assert.ok(edited.includes("      refs: [sky(0), sky(60)]\n"));
    assert.equal(readValue(edited, ref("surface.canvas", 1)), "sky(12 tint)");
    const canvas = resolveDefinition(edited).roles[0];
    assert.equal(canvas.perMode[2].ref, "sky(12 tint)", "the silent mode follows its parent's new ref");
  });

  test("a mode the role says nothing for reads as ~, held in place or left off the end", () => {
    assert.equal(readValue(ROLES, ref("surface.canvas", 2)), "~");
    assert.equal(readValue(ROLES, ref("surface.card", 2)), "~");
  });

  test("a ref is written over a ~, and added to a list that stops short", () => {
    const edited = applyEdits(ROLES, [
      { action: "set", target: ref("surface.canvas", 2), value: "sky(20)" },
      { action: "set", target: ref("surface.card", 2), value: "sky(3)" },
    ]);
    assert.ok(edited.includes("    canvas: [sky(3), sky(8), sky(20)] # the page\n"));
    assert.ok(edited.includes("    card: [sky(1), sky(1), sky(3)]\n"));
    assert.equal(resolveDefinition(edited).roles[1].inherited[2], false);
  });

  test("the modes between a short list's end and the new ref are held with ~", () => {
    const fourModes = ROLES.replace("  black: { extends: dark }\n", "  black: { extends: dark }\n  dim: { extends: dark }\n");
    const edited = applyEdits(fourModes, [{ action: "set", target: ref("surface.card", 3), value: "sky(3)" }]);
    assert.ok(edited.includes("    card: [sky(1), sky(1), ~, sky(3)]\n"));
    assert.equal(readValue(edited, ref("surface.card", 2)), "~");
  });

  test("a block list gets a new line after the last item's comment", () => {
    const block = ROLES.replace(
      "    card: [sky(1), sky(1)]\n",
      "    card:\n      - sky(1)\n      - sky(1) # same\n",
    );
    const edited = applyEdits(block, [{ action: "set", target: ref("surface.card", 2), value: "sky(3)" }]);
    assert.ok(edited.includes("      - sky(1) # same\n      - sky(3)\n  label:"));
  });

  test("~ puts a mode back to saying nothing", () => {
    const overridden = applyEdits(ROLES, [{ action: "set", target: ref("surface.card", 2), value: "sky(3)" }]);
    const edited = applyEdits(overridden, [{ action: "set", target: ref("surface.card", 2), value: "~" }]);
    assert.ok(edited.includes("    card: [sky(1), sky(1), ~]\n"));
    assert.equal(resolveDefinition(edited).roles[1].inherited[2], true);
    assert.equal(applyEdits(ROLES, [{ action: "set", target: ref("surface.card", 2), value: "~" }]), ROLES);
  });

  test("a ref YAML would split is quoted", () => {
    const edited = applyEdits(ROLES, [{ action: "set", target: ref("surface.card", 0), value: "sky(1, tint)" }]);
    assert.ok(edited.includes('card: ["sky(1, tint)", sky(1)]'));
  });

  test("a definition without modes holds the ref as the role itself", () => {
    const flat = `dtg: 1\npalette:\n  paper: "#ffffff"\n  shade: "#000000"\nroles:\n  label: { primary: paper }\n`;
    const edited = applyEdits(flat, [{ action: "set", target: ref("label.primary", 0), value: "shade" }]);
    assert.ok(edited.includes("label: { primary: shade }"));
  });
});

describe("a number param", () => {
  test("is written bare, so it stays a number", () => {
    const edited = applyEdits(SRC, [{ action: "set", target: { kind: "default", algorithm: "scale", path: "hueShift" }, value: "20" }]);
    assert.ok(edited.includes("    hueShift: 20\n"));
    assert.equal(resolveDefinition(edited).systems.find((s) => s.system === "theme")!.params.hueShift, 20);
  });
});
