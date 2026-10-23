import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readBackgroundOverrides, withBackgroundOverrides } from "../dist/dev-settings.js";

const CONFIG = `# project config
gamut: srgb
outputs:
  css: app/colors.css # shipped
`;

describe("editor.backgrounds", () => {
  test("is read by mode, number-like names included", () => {
    const config = `editor:\n  backgrounds:\n    light: "#ffffff"\n    "900": oklch(0.2 0.02 260)\n`;
    assert.deepEqual(readBackgroundOverrides(config), { light: "#ffffff", "900": "oklch(0.2 0.02 260)" });
  });

  test("is empty when the file says nothing", () => {
    assert.deepEqual(readBackgroundOverrides(""), {});
    assert.deepEqual(readBackgroundOverrides(CONFIG), {});
    assert.deepEqual(readBackgroundOverrides("editor:\n  backgrounds:\n"), {});
  });

  test("takes a ref as well as a color, and refuses what is not a map", () => {
    assert.deepEqual(readBackgroundOverrides("editor:\n  backgrounds:\n    dark: surface.canvas\n"), { dark: "surface.canvas" });
    assert.throws(() => readBackgroundOverrides("editor:\n  backgrounds: [white]\n"), /expected a map of mode: color or ref/);
    assert.throws(() => readBackgroundOverrides("editor:\n  backgrounds:\n    dark: ''\n"), /editor\.backgrounds\.dark: a background needs/);
  });

  test("is written into a file that had none, keeping the rest", () => {
    const written = withBackgroundOverrides(CONFIG, { dark: "oklch(0.3 0.05 260)" });
    assert.ok(written.startsWith(CONFIG), "what was there is untouched, comments included");
    assert.deepEqual(readBackgroundOverrides(written), { dark: "oklch(0.3 0.05 260)" });
  });

  test("is written into an empty file, in block style", () => {
    const written = withBackgroundOverrides("", { dark: "#101114" });
    assert.equal(written, 'editor:\n  backgrounds:\n    dark: "#101114"\n');
    assert.equal(withBackgroundOverrides("{}\n", { dark: "night(4)" }), "editor:\n  backgrounds:\n    dark: night(4)\n");
  });

  test("no overrides takes the key back out", () => {
    const written = withBackgroundOverrides(CONFIG, { dark: "#101114" });
    assert.equal(withBackgroundOverrides(written, {}), CONFIG);
    assert.equal(withBackgroundOverrides(withBackgroundOverrides("", { dark: "#101114" }), {}), "");
  });

  test("an override the app could not show is not written", () => {
    assert.throws(() => withBackgroundOverrides("", { "": "#fff" }), /needs a mode/);
    assert.throws(() => withBackgroundOverrides("", { dark: " " }), /editor\.backgrounds\.dark/);
  });
});
