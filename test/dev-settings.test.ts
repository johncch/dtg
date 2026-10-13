import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readBackgrounds, withBackgrounds } from "../dist/dev-settings.js";

const CONFIG = `# project config
gamut: srgb
outputs:
  css: app/colors.css # shipped
`;

describe("dev.backgrounds", () => {
  test("is read in the order written, number-like names included", () => {
    const config = `dev:\n  backgrounds:\n    paper: "#ffffff"\n    "900": oklch(0.2 0.02 260)\n    "100": "#f0f0f0"\n`;
    assert.deepEqual(readBackgrounds(config), [
      { name: "paper", color: "#ffffff" },
      { name: "900", color: "oklch(0.2 0.02 260)" },
      { name: "100", color: "#f0f0f0" },
    ]);
  });

  test("is empty when the file says nothing", () => {
    assert.deepEqual(readBackgrounds(""), []);
    assert.deepEqual(readBackgrounds(CONFIG), []);
    assert.deepEqual(readBackgrounds("dev:\n  backgrounds:\n"), []);
  });

  test("refuses what is not a map of colors", () => {
    assert.throws(() => readBackgrounds("dev:\n  backgrounds: [white]\n"), /expected a map of name: color/);
    assert.throws(() => readBackgrounds("dev:\n  backgrounds:\n    paper: papery\n"), /dev\.backgrounds\.paper/);
  });

  test("is written into a file that had none, keeping the rest", () => {
    const written = withBackgrounds(CONFIG, [
      { name: "paper", color: "#ffffff" },
      { name: "dusk", color: "oklch(0.3 0.05 260)" },
    ]);
    assert.ok(written.startsWith(CONFIG), "what was there is untouched, comments included");
    assert.deepEqual(readBackgrounds(written), [
      { name: "paper", color: "#ffffff" },
      { name: "dusk", color: "oklch(0.3 0.05 260)" },
    ]);
  });

  test("is written into an empty file", () => {
    const written = withBackgrounds("", [{ name: "ink", color: "#101114" }]);
    assert.deepEqual(readBackgrounds(written), [{ name: "ink", color: "#101114" }]);
  });

  test("an empty list takes the key back out", () => {
    const written = withBackgrounds(CONFIG, [{ name: "ink", color: "#101114" }]);
    assert.equal(withBackgrounds(written, []), CONFIG);
  });

  test("a list the app could not offer is not written", () => {
    assert.throws(() => withBackgrounds("", [{ name: "", color: "#fff" }]), /needs a name/);
    assert.throws(
      () =>
        withBackgrounds("", [
          { name: "ink", color: "#101114" },
          { name: "ink", color: "#000000" },
        ]),
      /"ink" appears twice/,
    );
  });
});
