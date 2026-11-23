import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const CLI = new URL("../dist/cli.js", import.meta.url).pathname;

function dtg(...args: string[]) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status, stdout, stderr };
}

describe("cli flags", () => {
  test("an unknown flag is refused, not ignored", () => {
    const { status, stderr } = dtg("build", "--tailwnd", "out.css");
    assert.equal(status, 1);
    assert.match(stderr, /build: unknown flag --tailwnd/);
  });

  test("a flag belongs to its command", () => {
    const { status, stderr } = dtg("edit", "--watch");
    assert.equal(status, 1);
    assert.match(stderr, /edit: unknown flag --watch/);
  });

  test("a removed flag says what replaced it", () => {
    assert.match(dtg("build", "--live").stderr, /is now `dtg build --watch`/);
    assert.match(dtg("build", "--css-format", "tailwind").stderr, /--css-format was removed/);
  });

  test("a flag that takes a value needs one", () => {
    const { status, stderr } = dtg("docs", "--out");
    assert.equal(status, 1);
    assert.match(stderr, /docs: .*--out/);
  });

  test("a stray argument is refused", () => {
    const { status, stderr } = dtg("build", "colors.dtg.yaml");
    assert.equal(status, 1);
    assert.match(stderr, /build: unexpected "colors\.dtg\.yaml"/);
  });

  test("--help after a command prints help", () => {
    const { status, stdout } = dtg("build", "--help");
    assert.equal(status, 0);
    assert.match(stdout, /^dtg \d/);
  });
});
