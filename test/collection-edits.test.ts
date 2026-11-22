import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, readValue } from "../dist/edit.js";
import { resolveDefinition } from "../dist/resolve.js";
import { changesOf, openFile, withEdits } from "../dist/working-copy.js";

const DISK = `dtg: 1
modes: [light, dark]
palette:
  paper: "#ffffff"
  ink: "#313133"

roles:
  surface: [paper, ink]
  text: [ink, paper]

components:
  button:
    fill: [surface, surface]
`;

const alerts = { kind: "collection", name: "alerts" } as const;
const components = { kind: "collection", name: "components" } as const;

describe("a collection", () => {
  test("is added empty at the end of the file, and resolves", () => {
    const text = applyEdits(DISK, [{ action: "add", target: alerts, value: "{}" }]);
    assert.equal(text, `${DISK}\nalerts: {}\n`);
    assert.deepEqual(resolveDefinition(text).sections.map((section) => section.name), ["roles", "components", "alerts"]);
  });

  test("takes its first role as a block", () => {
    const text = applyEdits(DISK, [
      { action: "add", target: alerts, value: "{}" },
      { action: "add", target: { kind: "role", section: "alerts", path: "new-role" }, value: JSON.stringify(["paper", "ink"]) },
    ]);
    assert.match(text, /\nalerts:\n  new-role: \[paper, ink\]\n$/);
  });

  test("cannot take a name the grammar keeps or the file has", () => {
    assert.throws(() => applyEdits(DISK, [{ action: "add", target: { kind: "collection", name: "palette" }, value: "{}" }]));
    assert.throws(() => applyEdits(DISK, [{ action: "add", target: components, value: "{}" }]));
    assert.throws(() => applyEdits(DISK, [{ action: "rename", target: components, name: "roles" }]));
  });

  test("renamed rewrites its key and nothing else", () => {
    const text = applyEdits(DISK, [{ action: "rename", target: components, name: "parts" }]);
    assert.equal(text, DISK.replace("components:", "parts:"));
    assert.deepEqual(resolveDefinition(text).problems, []);
  });

  test("removed goes with its roles and the blank line before it", () => {
    const text = applyEdits(DISK, [{ action: "remove", target: components }]);
    assert.equal(text, DISK.slice(0, DISK.indexOf("\ncomponents:")));
  });

  test("left by its last role stays, empty", () => {
    const text = applyEdits(DISK, [{ action: "remove", target: { kind: "role", section: "components", path: "button.fill" } }]);
    assert.match(text, /\ncomponents: \{\}\n$/);
    assert.deepEqual(resolveDefinition(text).sections.map((section) => section.name), ["roles", "components"]);
  });

  test("reads as {} where the file has it", () => {
    assert.equal(readValue(DISK, components), "{}");
    assert.equal(readValue(DISK, alerts), null);
    assert.equal(readValue(DISK, { kind: "collection", name: "palette" }), null);
  });
});

describe("collection changes", () => {
  test("a ref edited in a renamed collection is the file's role's ref", () => {
    const copy = withEdits(openFile(DISK), [
      { action: "rename", target: components, name: "parts" },
      { action: "set", target: { kind: "ref", section: "parts", role: "button.fill", mode: 1 }, value: "text" },
    ]);
    assert.deepEqual(changesOf(copy), [
      { action: "rename", target: components, to: { kind: "collection", name: "parts" } },
      { action: "set", target: { kind: "ref", section: "parts", role: "button.fill", mode: 1 }, from: "surface", to: "text" },
    ]);
  });

  test("a removed collection is one change, its edited refs with it", () => {
    const copy = withEdits(openFile(DISK), [
      { action: "set", target: { kind: "ref", section: "components", role: "button.fill", mode: 1 }, value: "text" },
      { action: "remove", target: components },
    ]);
    assert.deepEqual(changesOf(copy), [{ action: "remove", target: components, from: "{}" }]);
  });
});
