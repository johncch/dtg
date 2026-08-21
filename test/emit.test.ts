import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolveDefinition } from "../dist/resolve.js";
import { emitCss, emitDtcg } from "../dist/emit.js";

const SRC = `
dtg: 1
modes: [light, dark]
changelog:
  - 2026-08-16: shadow.2 became shadow.3
systems:
  paper: "#ffffff"
  reds:
    alias: warm
    rose: "#ff0000"
  sky:
    algorithm: ink-ramp
    alias: light
    params: { base: "#fafdff", ink: "#001a28" }
roles:
  surface:
    canvas: [sky/3, sky/8]
    flat: [paper, reds.rose]
`;
const resolved = resolveDefinition(SRC);
const NS = "com.fifthrevision.dtg";

describe("css", () => {
  test("plain puts primitives in :root; tailwind wraps them in @theme", () => {
    const plain = emitCss(resolved, "plain");
    const tw = emitCss(resolved, "tailwind");
    assert.ok(plain.includes(":root {\n  /* sky (ink-ramp) */"));
    assert.ok(!plain.includes("@theme"));
    assert.ok(tw.includes("@theme {"));
    assert.ok(tw.includes("@theme inline {"));
  });

  test("emitted names use aliases; values agree across formats", () => {
    const css = emitCss(resolved, "plain");
    assert.ok(css.includes("--color-light-3: #f3f6f9;"));
    assert.ok(css.includes("--color-warm-rose: #ff0000;"));
    assert.ok(css.includes("--surface-flat: var(--color-paper);"));
  });

  test("emit is a pure function of the definition", () => {
    assert.equal(
      emitCss(resolved, "plain"),
      emitCss(resolveDefinition(SRC), "plain"),
    );
  });
});

describe("dtcg", () => {
  test("descriptions carry identity, not the recipe", () => {
    const d = emitDtcg(resolved) as any;
    // a role's identity is its internal path, untouched by alias/omit
    assert.equal(d.roles.surface.canvas.$description, "surface.canvas");
    // a demand-driven step's is who demands it, so renumbering is safe
    assert.equal(d.systems.sky["3"].$description, "surface.canvas[light]");
    // the volatile recipe lives in extensions instead
    assert.equal(d.systems.sky["3"].$extensions[NS].ref, "sky/3");
    assert.equal(d.systems.sky["3"].$extensions[NS].name, "light/3");
  });

  test("groups nest rather than embedding dotted keys", () => {
    const d = emitDtcg(resolved) as any;
    assert.deepEqual(Object.keys(d.systems.static), ["paper", "reds"]);
    assert.equal(d.systems.static.reds.rose.$value, "#ff0000");
    assert.equal(d.roles.surface.flat.$value, "{systems.static.paper}");
  });

  test("the changelog rides at the root, uninterpreted", () => {
    const d = emitDtcg(resolved) as any;
    assert.deepEqual(d.$extensions[NS].changelog, [
      { date: "2026-08-16", note: "shadow.2 became shadow.3" },
    ]);
  });

  test("no changelog means the key is absent, not empty", () => {
    const without = SRC.replace(
      "changelog:\n  - 2026-08-16: shadow.2 became shadow.3\n",
      "",
    );
    const d = emitDtcg(resolveDefinition(without)) as any;
    assert.equal("changelog" in d.$extensions[NS], false);
  });
});
