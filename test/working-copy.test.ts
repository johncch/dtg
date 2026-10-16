import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { changesOf, discard, editsOf, openFile, redo, undo, withEdit, withEdits, workingText } from "../dist/working-copy.js";
import { readValue } from "../dist/edit.js";

const DISK = `dtg: 1
palette:
  paper: "#ffffff"
  ink: "#313133" # text

systems:
  sky:
    algorithm: tint
    params: { base: "#fafdff", tint: "#001a28" }
`;
const paper = { kind: "constant", path: "paper" } as const;
const ink = { kind: "constant", path: "ink" } as const;
const skyBase = { kind: "param", system: "sky", path: "base" } as const;

describe("working copy", () => {
  test("with no edits it is the file", () => {
    assert.deepEqual(workingText(openFile(DISK)), { text: DISK, dropped: [] });
    assert.deepEqual(changesOf(openFile(DISK)), []);
  });

  test("edits apply in order, and a later edit to the same color wins", () => {
    const copy = {
      diskText: DISK,
      undone: [],
      steps: [
        [{ action: "set", target: paper, value: "#fffaf0" }],
        [{ action: "set", target: skyBase, value: "#f0f4ff" }],
        [{ action: "set", target: paper, value: "#fff5e0" }],
      ],
    };
    const { text, dropped } = workingText(copy);
    assert.deepEqual(dropped, []);
    assert.equal(readValue(text, paper), "#fff5e0");
    assert.equal(readValue(text, skyBase), "#f0f4ff");
    assert.equal(readValue(text, ink), "#313133");
  });

  test("changes are counted per color against the file, not per edit", () => {
    const changes = changesOf({
      diskText: DISK,
      undone: [],
      steps: [
        [{ action: "set", target: paper, value: "#fffaf0" }],
        [{ action: "set", target: skyBase, value: "#f0f4ff" }],
        [{ action: "set", target: paper, value: "#fff5e0" }],
      ],
    });
    assert.deepEqual(changes, [
      { action: "set", target: skyBase, from: "#fafdff", to: "#f0f4ff" },
      { action: "set", target: paper, from: "#ffffff", to: "#fff5e0" },
    ]);
  });

  test("a color edited back to what the file has is not a change", () => {
    const changes = changesOf({
      diskText: DISK,
      undone: [],
      steps: [
        [{ action: "set", target: paper, value: "#fffaf0" }],
        [{ action: "set", target: paper, value: "#ffffff" }],
      ],
    });
    assert.deepEqual(changes, []);
  });

  test("edits carry over when the file changes underneath them", () => {
    const edits = [{ action: "set", target: skyBase, value: "#f0f4ff" }];
    const pulled = DISK.replace('"#313133" # text', '"#202022" # darker text');
    const { text, dropped } = workingText({ diskText: pulled, steps: [edits], undone: [] });
    assert.deepEqual(dropped, []);
    assert.equal(readValue(text, ink), "#202022");
    assert.equal(readValue(text, skyBase), "#f0f4ff");
  });

  test("an edit whose color the file no longer has is dropped, and the rest still apply", () => {
    const withoutPaper = DISK.replace('  paper: "#ffffff"\n', "");
    const copy = {
      diskText: withoutPaper,
      undone: [],
      steps: [
        [{ action: "set", target: paper, value: "#fffaf0" }],
        [{ action: "set", target: skyBase, value: "#f0f4ff" }],
      ],
    };
    const { text, dropped } = workingText(copy);
    assert.deepEqual(dropped, [{ action: "set", target: paper, value: "#fffaf0" }]);
    assert.equal(readValue(text, skyBase), "#f0f4ff");
    assert.deepEqual(changesOf(copy), [{ action: "set", target: skyBase, from: "#fafdff", to: "#f0f4ff" }]);
  });
});

describe("undo and redo", () => {
  const a = { action: "set", target: paper, value: "#fffaf0" };
  const b = { action: "set", target: skyBase, value: "#f0f4ff" };
  const c = { action: "set", target: ink, value: "#202022" };
  const three = [a, b, c].reduce(withEdit, openFile(DISK));

  test("undo takes back the last edit, redo brings it back", () => {
    const back = undo(three);
    assert.deepEqual(editsOf(back), [a, b]);
    assert.equal(readValue(workingText(back).text, ink), "#313133");
    assert.deepEqual(editsOf(redo(back)), [a, b, c]);
    assert.deepEqual(redo(back).undone, []);
  });

  test("with nothing to undo or redo, the copy is returned as it was", () => {
    assert.equal(undo(openFile(DISK)).steps.length, 0);
    assert.deepEqual(redo(three), three);
  });

  test("a new edit after an undo leaves nothing to redo", () => {
    const d = { action: "set", target: paper, value: "#eeeeee" };
    const branched = withEdit(undo(three), d);
    assert.deepEqual(editsOf(branched), [a, b, d]);
    assert.deepEqual(redo(branched), branched);
  });

  test("discard drops every change, and redo brings them back in the order they were made", () => {
    const cleared = discard(three);
    assert.deepEqual(changesOf(cleared), []);
    assert.equal(workingText(cleared).text, DISK);
    assert.deepEqual(editsOf(redo(cleared)), [a]);
    assert.deepEqual(editsOf(redo(redo(redo(cleared)))), [a, b, c]);
  });
});

describe("steps", () => {
  const a = { action: "set" as const, target: paper, value: "#fffaf0" };
  const b = { action: "set" as const, target: skyBase, value: "#f0f4ff" };

  test("edits made together are one step: one undo takes them all back, one redo brings them back", () => {
    const rolled = withEdits(openFile(DISK), [a, b]);
    assert.equal(changesOf(rolled).length, 2);
    assert.deepEqual(undo(rolled).steps, []);
    assert.deepEqual(redo(undo(rolled)).steps, [[a, b]]);
  });
});
