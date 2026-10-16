import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveDefinition } from "../dist/resolve.js";
import { emitCss, emitDtcg } from "../dist/emit.js";

// The property every refactor has to preserve: same definition, same bytes.
// The fixture exercises every algorithm and every ref form, so a change that
// moves any emitted byte fails here rather than in a consumer's repo.
const here = new URL("./fixtures/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, here), "utf8");
const resolved = resolveDefinition(read("kitchen-sink.dtg.yaml"));

describe("golden output", () => {
  test("plain CSS is byte-identical", () => {
    assert.equal(emitCss(resolved, "plain"), read("kitchen-sink.plain.css"));
  });

  test("tailwind CSS is byte-identical", () => {
    assert.equal(
      emitCss(resolved, "tailwind"),
      read("kitchen-sink.tailwind.css"),
    );
  });

  test("DTCG is byte-identical", () => {
    assert.equal(
      JSON.stringify(emitDtcg(resolved), null, 2) + "\n",
      read("kitchen-sink.tokens.json"),
    );
  });

  test("the fixture actually exercises every algorithm", () => {
    const used = new Set(resolved.systems.map((s) => s.algorithm));
    assert.deepEqual(
      [...used].sort(),
      ["overlay", "scale", "tint"],
    );
  });

  test("and every ref form", () => {
    const kinds = new Set(
      resolved.roles.flatMap((r) => r.perMode.map((e) => e.target.kind)),
    );
    assert.deepEqual([...kinds].sort(), ["constant", "role", "step"]);
    const refs = resolved.roles.flatMap((r) => r.perMode.map((e) => e.ref));
    assert.ok(refs.some((r) => r.endsWith(" tint)")));
    assert.ok(refs.some((r) => r.startsWith("transparent(")));
    assert.ok(refs.some((r) => /^\w+\.[\w.]+\(/.test(r)));
  });

  test("resolving twice gives identical bytes", () => {
    const again = resolveDefinition(read("kitchen-sink.dtg.yaml"));
    assert.equal(emitCss(again, "plain"), emitCss(resolved, "plain"));
  });
});
