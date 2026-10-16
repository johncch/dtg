import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, writePlaceholderConfig } from "../dist/config.js";

const DEFINITION = join("design-tokens", "c.dtg.yaml");

/**
 * loadConfig reads dtg.config.yaml from the cwd, so each case gets its own. The
 * dtg.config.yaml written names the definition, since nothing finds one unnamed;
 * a case with no dtg.config.yaml passes it as the flag.
 */
function inProject(dtgYaml: string | null, run: () => void) {
  const dir = mkdtempSync(join(tmpdir(), "dtg-cfg-"));
  mkdirSync(join(dir, "design-tokens"));
  writeFileSync(join(dir, DEFINITION), "dtg: 1\n");
  if (dtgYaml != null) {
    const named = dtgYaml.includes("definitions:") ? dtgYaml : `definitions: ${DEFINITION}\n${dtgYaml}`;
    writeFileSync(join(dir, "dtg.config.yaml"), named);
  }
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
  test("no dtg.config.yaml at all — css", () => {
    inProject(null, () => {
      const c = loadConfig({ definition: DEFINITION });
      assert.equal(c.cssOut, join("design-tokens", "tokens.generated.css"), "beside the definition");
      assert.equal(c.scssOut, undefined);
      assert.equal(c.dtcgOut, undefined);
    });
  });

  test("a dtg.config.yaml naming no outputs — still css", () => {
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
      const c = loadConfig({ definition: DEFINITION, scss: "out/v.scss" });
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

describe("gamut", () => {
  test("defaults to display-p3", () => {
    inProject(null, () => assert.equal(loadConfig({ definition: DEFINITION }).gamut, "display-p3"));
  });

  test("dtg.config.yaml sets it", () => {
    inProject("gamut: srgb\n", () => assert.equal(loadConfig({}).gamut, "srgb"));
  });

  test("an unknown gamut is an error", () => {
    inProject("gamut: rec2020\n", () =>
      assert.throws(() => loadConfig({}), /dtg\.config\.yaml gamut: expected one of srgb, display-p3/),
    );
  });
});

describe("init", () => {
  test("writes a dtg.config.yaml the loader reads", () => {
    inProject(null, () => {
      writePlaceholderConfig();
      const config = loadConfig({});
      assert.equal(config.definition, "colors.dtg.yaml");
      assert.equal(config.cssOut, "colors.generated.css");
    });
  });

  test("never replaces one that is there", () => {
    inProject("definitions: mine.dtg.yaml\n", () => {
      assert.throws(() => writePlaceholderConfig(), /dtg\.config\.yaml is already here/);
      assert.equal(readFileSync("dtg.config.yaml", "utf8"), "definitions: mine.dtg.yaml\n");
    });
  });
});

describe("where the definition is", () => {
  test("has no default: with nothing naming it, the error points at init", () => {
    inProject(null, () => assert.throws(() => loadConfig({}), /no definition to read — run `dtg init`/));
  });

  test("dtg.config.yaml names a file, or a directory holding one", () => {
    inProject(`definitions: ${DEFINITION}\n`, () => assert.equal(loadConfig({}).definition, DEFINITION));
    inProject("definitions: design-tokens\n", () => assert.equal(loadConfig({}).definition, DEFINITION));
  });
});
