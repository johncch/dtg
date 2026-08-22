import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../dist/config.js";

/** loadConfig reads dtg.yaml from the cwd, so each case gets its own. */
function inProject(dtgYaml: string | null, run: () => void) {
  const dir = mkdtempSync(join(tmpdir(), "dtg-cfg-"));
  mkdirSync(join(dir, "design-tokens"));
  writeFileSync(join(dir, "design-tokens", "c.dtg.yaml"), "dtg: 1\n");
  if (dtgYaml != null) writeFileSync(join(dir, "dtg.yaml"), dtgYaml);
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    run();
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("outputs is a set, not a bag of defaults", () => {
  test("no dtg.yaml at all — css", () => {
    inProject(null, () => {
      const c = loadConfig({});
      assert.ok(c.cssOut);
      assert.equal(c.scssOut, undefined);
      assert.equal(c.dtcgOut, undefined);
    });
  });

  test("a dtg.yaml naming no outputs — still css", () => {
    inProject("definitions: design-tokens\n", () => {
      assert.ok(loadConfig({}).cssOut);
    });
  });

  test("naming scss replaces the set — no css", () => {
    inProject("outputs:\n  scss: out/v.scss\n", () => {
      const c = loadConfig({});
      assert.equal(c.cssOut, undefined);
      assert.equal(c.scssOut, "out/v.scss");
    });
  });

  test("naming several gives exactly those", () => {
    inProject("outputs:\n  scss: out/v.scss\n  dtcg: out/t.json\n", () => {
      const c = loadConfig({});
      assert.equal(c.cssOut, undefined);
      assert.ok(c.scssOut && c.dtcgOut);
    });
  });

  test("a flag names an output too", () => {
    inProject(null, () => {
      const c = loadConfig({ scss: "out/v.scss" });
      assert.equal(c.cssOut, undefined);
      assert.equal(c.scssOut, "out/v.scss");
    });
  });

  test("an unknown output is refused rather than ignored", () => {
    inProject("outputs:\n  sass: out/v.sass\n", () => {
      assert.throws(() => loadConfig({}), /unknown output "sass"/);
    });
  });
});
