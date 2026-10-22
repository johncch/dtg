import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { appShell } from "../dist/app-shell.js";

describe("the app's page", () => {
  test("served by dev, points at the bundle from the root", () => {
    const html = appShell("dtg", "served");
    assert.ok(html.includes('<meta name="dtg-mode" content="served">'));
    assert.ok(html.includes('src="/ui/dtg-ui.js"'));
  });

  test("as a static copy, points at its files relatively, so it works from any folder", () => {
    const html = appShell("dtg", "static");
    assert.ok(html.includes('<meta name="dtg-mode" content="static">'));
    assert.ok(html.includes('src="ui/dtg-ui.js"'));
    assert.ok(html.includes('href="ui/dtg-ui.css"'));
    assert.ok(!html.includes('"/ui/'));
    assert.ok(!html.includes("dtg-editable"));
  });

  test("an editable static copy says so", () => {
    const html = appShell("dtg", "static", true);
    assert.ok(html.includes('<meta name="dtg-editable" content="true">'));
  });
});
