import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderBlend } from "../dist/render.js";
import { resolveDefinition } from "../dist/resolve.js";

describe("blend tool", () => {
  test("uses the Color API rather than the removed css/hex result shape", () => {
    const html = renderBlend(resolveDefinition("dtg: 1\n"), null);
    assert.match(html, /parseColor\(\$\("a"\)\.value/);
    assert.match(html, /formatColor\(r,/);
    assert.doesNotMatch(html, /r\.(?:css|hex)/);
    assert.doesNotMatch(html, /mixIn\(A, B, t, s\.id\)\.hex/);
  });
});
