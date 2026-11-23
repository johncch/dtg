import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { compareStylesheets } from "../dist/compare.js";

const OLD = `
:root {
  --gray-500: #7c808a;
  --text-muted: var(--gray-500);
  --selection: rgba(232, 83, 63, 0.25);
  --space-4: 4px;
  --gone: #123456;
}
.dark { --text-muted: #8b949e; }
[dir="rtl"] { --x: #000000; }
`;

const BUILT = `
:root {
  /* gray (tint) */
  --gray-55: #7c8088;
}
:root {
  --gray-500: var(--gray-55);
  --text-muted: var(--gray-500);
  --selection: rgba(232, 83, 63, 0.25);
}
.dark { --text-muted: #8e9296; }
@supports (color: color(display-p3 1 1 1)) {
  :root { --gray-55: color(display-p3 1 0 0); }
}
`;

describe("compare", () => {
  test("follows var() chains in each mode and measures what moved", () => {
    const c = compareStylesheets(OLD, BUILT, ["light", "dark"]);
    assert.deepEqual(
      c.moved.map((m) => [m.name, m.mode]),
      [["--text-muted", "dark"], ["--gray-500", "light"], ["--gray-500", "dark"], ["--text-muted", "light"]],
    );
    assert.ok(c.moved.every((m) => m.deltaE < 0.02));
    assert.ok(!c.moved.some((m) => m.name === "--selection"), "a legacy rgba() reads as the same color");
  });

  test("lists colors only one side declares, and selectors naming no mode", () => {
    const c = compareStylesheets(OLD, BUILT, ["light", "dark"]);
    assert.deepEqual(c.onlyBefore, ["--gone"]);
    assert.deepEqual(c.onlyAfter, ["--gray-55"]);
    assert.deepEqual(c.unplaced, ['[dir="rtl"]']);
  });
});
