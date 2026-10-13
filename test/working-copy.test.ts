import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { changesOf, discard, openFile, redo, undo, withEdit, workingText } from "../dist/working-copy.js";
import { readValue } from "../dist/edit.js";

const DISK = `dtg: 1
systems:
  paper: "#ffffff"
  ink: "#313133" # text
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
      edits: [
        { target: paper, value: "#fffaf0" },
        { target: skyBase, value: "#f0f4ff" },
        { target: paper, value: "#fff5e0" },
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
      edits: [
        { target: paper, value: "#fffaf0" },
        { target: skyBase, value: "#f0f4ff" },
        { target: paper, value: "#fff5e0" },
      ],
    });
    assert.deepEqual(changes, [
      { target: skyBase, from: "#fafdff", to: "#f0f4ff" },
      { target: paper, from: "#ffffff", to: "#fff5e0" },
    ]);
  });

  test("a color edited back to what the file has is not a change", () => {
    const changes = changesOf({
      diskText: DISK,
      undone: [],
      edits: [
        { target: paper, value: "#fffaf0" },
        { target: paper, value: "#ffffff" },
      ],
    });
    assert.deepEqual(changes, []);
  });

  test("edits carry over when the file changes underneath them", () => {
    const edits = [{ target: skyBase, value: "#f0f4ff" }];
    const pulled = DISK.replace('"#313133" # text', '"#202022" # darker text');
    const { text, dropped } = workingText({ diskText: pulled, edits, undone: [] });
    assert.deepEqual(dropped, []);
    assert.equal(readValue(text, ink), "#202022");
    assert.equal(readValue(text, skyBase), "#f0f4ff");
  });

  test("an edit whose color the file no longer has is dropped, and the rest still apply", () => {
    const withoutPaper = DISK.replace('  paper: "#ffffff"\n', "");
    const copy = {
      diskText: withoutPaper,
      undone: [],
      edits: [
        { target: paper, value: "#fffaf0" },
        { target: skyBase, value: "#f0f4ff" },
      ],
    };
    const { text, dropped } = workingText(copy);
    assert.deepEqual(dropped, [{ target: paper, value: "#fffaf0" }]);
    assert.equal(readValue(text, skyBase), "#f0f4ff");
    assert.deepEqual(changesOf(copy), [{ target: skyBase, from: "#fafdff", to: "#f0f4ff" }]);
  });
});

describe("undo and redo", () => {
  const a = { target: paper, value: "#fffaf0" };
  const b = { target: skyBase, value: "#f0f4ff" };
  const c = { target: ink, value: "#202022" };
  const three = [a, b, c].reduce(withEdit, openFile(DISK));

  test("undo takes back the last edit, redo brings it back", () => {
    const back = undo(three);
    assert.deepEqual(back.edits, [a, b]);
    assert.equal(readValue(workingText(back).text, ink), "#313133");
    assert.deepEqual(redo(back).edits, [a, b, c]);
    assert.deepEqual(redo(back).undone, []);
  });

  test("with nothing to undo or redo, the copy is returned as it was", () => {
    assert.equal(undo(openFile(DISK)).edits.length, 0);
    assert.deepEqual(redo(three), three);
  });

  test("a new edit after an undo leaves nothing to redo", () => {
    const d = { target: paper, value: "#eeeeee" };
    const branched = withEdit(undo(three), d);
    assert.deepEqual(branched.edits, [a, b, d]);
    assert.deepEqual(redo(branched), branched);
  });

  test("discard drops every change, and redo brings them back in the order they were made", () => {
    const cleared = discard(three);
    assert.deepEqual(changesOf(cleared), []);
    assert.equal(workingText(cleared).text, DISK);
    assert.deepEqual(redo(cleared).edits, [a]);
    assert.deepEqual(redo(redo(redo(cleared))).edits, [a, b, c]);
  });
});
