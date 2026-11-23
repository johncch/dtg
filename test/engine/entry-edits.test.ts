import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, readValue, type Edit } from "../../dist/engine/edit.js";
import { resolveDefinition } from "../../dist/engine/resolve.js";
import { changesOf, openFile, withEdit } from "../../dist/engine/working-copy.js";

const SRC = `dtg: 1
modes:
  light: {}
  dark: {}

palette:
  paper: "#ffffff"
  ink:
    body: "#313133"
    muted: "#828282"

systems:
  sky:
    algorithm: tint
    params: { base: paper, tint: ink.body }
    emit: [50]

roles:
  surface:
    canvas: [sky(3), sky(90)]
    echo: [surface.canvas, surface.canvas]
  label:
    description: Text
    primary: [ink.body, paper]
    faded: [transparent(ink.body 40), transparent(paper 70)]
    quiet:
      alias: hushed
      refs: [ink.muted, ink.muted]
`;

const role = (path: string) => ({ kind: "role", section: "roles", path }) as const;
const constant = (path: string) => ({ kind: "constant", path }) as const;
const group = (root: string, path: string) => ({ kind: "group", root, path }) as const;
const emit = { kind: "emit", system: "sky" } as const;
const refs = (...list: string[]) => JSON.stringify(list);

/** The text after the edits, which must still resolve. */
function edited(edits: Edit[], text = SRC): string {
  const result = applyEdits(text, edits);
  resolveDefinition(result);
  return result;
}

const changes = (edits: Edit[]) => changesOf(edits.reduce(withEdit, openFile(SRC)));

describe("adding a role", () => {
  test("adds it at the end of its group", () => {
    const text = edited([{ action: "add", target: role("label.new"), value: refs("paper", "ink.body") }]);
    assert.ok(text.includes(`      refs: [ink.muted, ink.muted]\n    new: [paper, ink.body]\n`));
  });

  test("adds it after the sibling it names", () => {
    const text = edited([{ action: "add", target: role("label.new"), value: refs("paper", "ink.body"), after: "primary" }]);
    assert.ok(text.includes(`    primary: [ink.body, paper]\n    new: [paper, ink.body]\n    faded:`));
  });

  test("a mode that says nothing is written as ~", () => {
    const extending = SRC.replace("  dark: {}\n", "  dark: { extends: light }\n");
    const text = edited([{ action: "add", target: role("label.new"), value: refs("paper", "~") }], extending);
    assert.ok(text.includes(`    new: [paper, ~]\n`));
  });

  test("writes a group the section does not have", () => {
    const text = edited([{ action: "add", target: role("state.on"), value: refs("paper", "paper") }]);
    assert.ok(text.endsWith(`      refs: [ink.muted, ink.muted]\n  state:\n    on: [paper, paper]\n`));
  });

  test("cannot add where a role is already written", () => {
    assert.throws(() => applyEdits(SRC, [{ action: "add", target: role("label.primary"), value: refs("paper", "paper") }]), /already written/);
  });

  test("counts as one added role", () => {
    const target = role("label.new");
    assert.deepEqual(changes([{ action: "add", target, value: refs("paper", "ink.body") }]), [
      { action: "set", target, from: null, to: refs("paper", "ink.body") },
    ]);
  });
});

describe("renaming and removing a role", () => {
  test("a rename is followed by every ref to the role", () => {
    const text = edited([{ action: "rename", target: role("surface.canvas"), name: "page" }]);
    assert.ok(text.includes(`    page: [sky(3), sky(90)]\n    echo: [surface.page, surface.page]\n`));
  });

  test("removes a role, leaving its group", () => {
    const text = edited([{ action: "remove", target: role("surface.echo") }]);
    assert.ok(text.includes(`  surface:\n    canvas: [sky(3), sky(90)]\n  label:\n`));
  });

  test("a group goes with its last role", () => {
    const text = edited([
      { action: "remove", target: role("surface.echo") },
      { action: "remove", target: role("surface.canvas") },
    ]);
    assert.ok(text.includes(`roles:\n  label:\n`));
    assert.ok(!text.includes("surface"));
  });

  test("a removal reads as the role it took and the refs it held", () => {
    const target = role("surface.echo");
    assert.deepEqual(changes([{ action: "remove", target }]), [{ action: "remove", target, from: refs("surface.canvas", "surface.canvas") }]);
  });
});

describe("renaming what a transparent() holds", () => {
  const nested = SRC.replace(
    "    echo: [surface.canvas, surface.canvas]\n",
    "    echo: [surface.canvas, surface.canvas]\n    veil: [transparent(sky(3 tint) 50), transparent(surface.canvas 70)]\n",
  );

  test("a system's rename reaches a step inside", () => {
    const text = edited([{ action: "rename", target: { kind: "system", path: "sky" }, name: "air" }], nested);
    assert.ok(text.includes(`    veil: [transparent(air(3 tint) 50), transparent(surface.canvas 70)]\n`));
  });

  test("and the stops of a gradient", () => {
    const withGradient = nested.replace("    veil:", "    wash: [gradient(sky(3) 10% ink.body angle=90deg), gradient(surface.canvas transparent(sky(8) 50))]\n    veil:");
    const text = edited([{ action: "rename", target: { kind: "system", path: "sky" }, name: "air" }], withGradient);
    assert.ok(text.includes(`    wash: [gradient(air(3) 10% ink.body angle=90deg), gradient(surface.canvas transparent(air(8) 50))]\n`));
    const moved = edited([{ action: "rename", target: role("surface.canvas"), name: "page" }], withGradient);
    assert.ok(moved.includes(`gradient(surface.page transparent(sky(8) 50))]\n`));
  });

  test("a palette color's rename reaches a palette gradient made of it", () => {
    const withPalette = SRC.replace(`  paper: "#ffffff"\n`, `  paper: "#ffffff"\n  wash: gradient(paper ink.body 40% angle=90deg)\n`);
    const text = edited([{ action: "rename", target: constant("paper"), name: "page" }], withPalette);
    assert.ok(text.includes(`  page: "#ffffff"\n  wash: gradient(page ink.body 40% angle=90deg)\n`));
    assert.ok(text.includes(`primary: [ink.body, page]`));
  });

  test("a role's rename reaches a role inside", () => {
    const text = edited([{ action: "rename", target: role("surface.canvas"), name: "page" }], nested);
    assert.ok(text.includes(`    veil: [transparent(sky(3 tint) 50), transparent(surface.page 70)]\n`));
  });
});

describe("moving a role within its group", () => {
  test("moved first, it still follows what the group says about itself", () => {
    const text = edited([{ action: "move", target: role("label.faded"), after: null }]);
    assert.ok(text.includes(`    description: Text\n    faded: [transparent(ink.body 40), transparent(paper 70)]\n    primary: [ink.body, paper]\n`));
  });

  test("moves after the sibling named, a block role whole", () => {
    const text = edited([{ action: "move", target: role("label.quiet"), after: "primary" }]);
    assert.ok(text.includes(`    primary: [ink.body, paper]\n    quiet:\n      alias: hushed\n      refs: [ink.muted, ink.muted]\n    faded:`));
  });
});

describe("placing an entry at another path", () => {
  test("moves a role to a group that is there, every ref following", () => {
    const text = edited([{ action: "place", target: role("surface.canvas"), path: "label.canvas" }]);
    assert.ok(text.includes(`  surface:\n    echo: [label.canvas, label.canvas]\n`));
    assert.ok(text.endsWith(`    canvas: [sky(3), sky(90)]\n`));
  });

  test("writes the groups on the way that are not there", () => {
    const text = edited([{ action: "place", target: role("surface.echo"), path: "surface.deep.echo" }]);
    assert.ok(text.includes(`    canvas: [sky(3), sky(90)]\n    deep:\n      echo: [surface.canvas, surface.canvas]\n`));
  });

  test("a role written as a block keeps what it says, on one line", () => {
    const text = edited([{ action: "place", target: role("label.quiet"), path: "surface.quiet" }]);
    assert.ok(text.includes(`    quiet: { alias: hushed, refs: [ink.muted, ink.muted] }\n  label:\n`));
  });

  test("cannot be placed where another role is", () => {
    assert.throws(() => applyEdits(SRC, [{ action: "place", target: role("surface.canvas"), path: "label.primary" }]), /already written/);
  });

  test("moves a constant into a group, refs and params following", () => {
    const text = edited([{ action: "place", target: constant("paper"), path: "ink.paper" }]);
    assert.ok(text.includes(`palette:\n  ink:\n    body: "#313133"\n    muted: "#828282"\n    paper: "#ffffff"\n`));
    assert.ok(text.includes(`params: { base: ink.paper, tint: ink.body }`));
    assert.ok(text.includes(`faded: [transparent(ink.body 40), transparent(ink.paper 70)]`));
  });

  test("a group left empty goes", () => {
    const text = edited([
      { action: "place", target: constant("ink.muted"), path: "muted" },
      { action: "place", target: constant("ink.body"), path: "body" },
    ]);
    assert.ok(text.includes(`palette:\n  paper: "#ffffff"\n  muted: "#828282"\n  body: "#313133"\n\nsystems:`));
    assert.ok(text.includes(`params: { base: paper, tint: body }`));
  });

  test("reads as a rename to the new path", () => {
    assert.deepEqual(changes([{ action: "place", target: role("surface.canvas"), path: "label.canvas" }]), [
      { action: "rename", target: role("surface.canvas"), to: role("label.canvas") },
    ]);
  });
});

describe("renaming a group", () => {
  test("a role group's rename is followed by every ref into it", () => {
    const text = edited([{ action: "rename", target: group("roles", "surface"), name: "ground" }]);
    assert.ok(text.includes(`  ground:\n    canvas: [sky(3), sky(90)]\n    echo: [ground.canvas, ground.canvas]\n`));
  });

  test("a palette group's rename is followed by refs, params and transparent()", () => {
    const text = edited([{ action: "rename", target: group("palette", "ink"), name: "inks" }]);
    assert.ok(text.includes(`  inks:\n    body: "#313133"\n`));
    assert.ok(text.includes(`params: { base: paper, tint: inks.body }`));
    assert.ok(text.includes(`    primary: [inks.body, paper]\n    faded: [transparent(inks.body 40), transparent(paper 70)]\n`));
    assert.ok(text.includes(`refs: [inks.muted, inks.muted]`));
  });

  test("leaves refs into a group of another kind with the same name", () => {
    const shared = SRC.replace("  label:\n    description: Text\n", "  ink:\n    strong: [ink.body, ink.body]\n    echo: [ink.strong, transparent(ink.strong 50)]\n  label:\n    description: Text\n");
    assert.notEqual(shared, SRC);
    const roles = applyEdits(shared, [{ action: "rename", target: group("roles", "ink"), name: "text" }]);
    assert.ok(roles.includes(`  text:\n    strong: [ink.body, ink.body]\n    echo: [text.strong, transparent(text.strong 50)]\n`));
    assert.ok(roles.includes(`params: { base: paper, tint: ink.body }`));
    const palette = applyEdits(shared, [{ action: "rename", target: group("palette", "ink"), name: "inks" }]);
    assert.ok(palette.includes(`  ink:\n    strong: [inks.body, inks.body]\n    echo: [ink.strong, transparent(ink.strong 50)]\n`));
  });

  test("reads as one rename", () => {
    assert.deepEqual(changes([{ action: "rename", target: group("palette", "ink"), name: "inks" }]), [
      { action: "rename", target: group("palette", "ink"), to: group("palette", "inks") },
    ]);
  });
});

describe("a system's emit list", () => {
  test("reads as it is written", () => {
    assert.equal(readValue(SRC, emit), "[50]");
  });

  test("setting writes the whole list", () => {
    const text = edited([{ action: "set", target: emit, value: "[50,90]" }]);
    assert.ok(text.includes(`    emit: [50, 90]\n`));
  });

  test("an empty list takes the key away", () => {
    const text = edited([{ action: "set", target: emit, value: "[]" }]);
    assert.ok(text.includes(`    params: { base: paper, tint: ink.body }\n\nroles:`));
  });

  test("setting adds the key to a system without one, as publish", () => {
    const text = edited([{ action: "set", target: emit, value: "[10]" }], SRC.replace("    emit: [50]\n", ""));
    assert.ok(text.includes(`    params: { base: paper, tint: ink.body }\n    publish: [10]\n`));
  });

  test("written as publish, reads and sets under that key", () => {
    const text = SRC.replace("    emit: [50]", "    publish: [50]");
    assert.equal(readValue(text, emit), "[50]");
    assert.ok(edited([{ action: "set", target: emit, value: "[50,90]" }], text).includes(`    publish: [50, 90]\n`));
  });

  test("reads as one change against the file's list", () => {
    assert.deepEqual(changes([{ action: "set", target: emit, value: "[50,90]" }]), [{ action: "set", target: emit, from: "[50]", to: "[50,90]" }]);
  });
});

describe("the changes after a rename of what holds an entry", () => {
  test("a color edited before and after its group is renamed is one change, at its new path", () => {
    assert.deepEqual(
      changes([
        { action: "set", target: constant("ink.body"), value: "#111111" },
        { action: "rename", target: group("palette", "ink"), name: "inks" },
        { action: "set", target: constant("inks.body"), value: "#222222" },
        { action: "set", target: constant("inks.muted"), value: "#999999" },
      ]),
      [
        { action: "rename", target: group("palette", "ink"), to: group("palette", "inks") },
        { action: "set", target: constant("inks.body"), from: "#313133", to: "#222222" },
        { action: "set", target: constant("inks.muted"), from: "#828282", to: "#999999" },
      ],
    );
  });

  test("a color added to a group stays an added color once the group is renamed", () => {
    assert.deepEqual(
      changes([
        { action: "add", target: constant("ink.faint"), value: "#cccccc" },
        { action: "rename", target: group("palette", "ink"), name: "inks" },
      ]),
      [
        { action: "set", target: constant("inks.faint"), from: null, to: "#cccccc" },
        { action: "rename", target: group("palette", "ink"), to: group("palette", "inks") },
      ],
    );
  });

  test("a ref set after its role is renamed is a change to the role the file has", () => {
    const ref = (path: string) => ({ kind: "ref", section: "roles", role: path, mode: 1 }) as const;
    assert.deepEqual(
      changes([
        { action: "rename", target: role("label.primary"), name: "strong" },
        { action: "set", target: ref("label.strong"), value: "ink.muted" },
      ]),
      [
        { action: "rename", target: role("label.primary"), to: role("label.strong") },
        { action: "set", target: ref("label.strong"), from: "paper", to: "ink.muted" },
      ],
    );
  });

  test("a system's emit list set after the system is renamed is a change, not an addition", () => {
    const system = (path: string) => ({ kind: "system", path }) as const;
    assert.deepEqual(
      changes([
        { action: "rename", target: system("sky"), name: "air" },
        { action: "set", target: { kind: "emit", system: "air" }, value: "[50,90]" },
      ]),
      [
        { action: "rename", target: system("sky"), to: system("air") },
        { action: "set", target: { kind: "emit", system: "air" }, from: "[50]", to: "[50,90]" },
      ],
    );
  });

  test("an entry renamed inside a renamed group reads as renamed from where the file has it", () => {
    assert.deepEqual(
      changes([
        { action: "rename", target: group("palette", "ink"), name: "inks" },
        { action: "rename", target: constant("inks.body"), name: "strong" },
      ]),
      [
        { action: "rename", target: group("palette", "ink"), to: group("palette", "inks") },
        { action: "rename", target: constant("ink.body"), to: constant("inks.strong") },
      ],
    );
  });
});

describe("the changes after what holds an entry is removed", () => {
  test("a ref set on a role that is then removed is not a change of its own", () => {
    const target = role("surface.echo");
    assert.deepEqual(
      changes([
        { action: "set", target: { kind: "ref", section: "roles", role: "surface.echo", mode: 1 }, value: "paper" },
        { action: "remove", target },
      ]),
      [{ action: "remove", target, from: refs("surface.canvas", "surface.canvas") }],
    );
  });

  test("nor is a param or an emit list set on a system that is then removed", () => {
    const target = { kind: "system", path: "sky" } as const;
    const listed = changes([
      { action: "set", target: { kind: "param", system: "sky", path: "base" }, value: "#eeeeee" },
      { action: "set", target: emit, value: "[50,90]" },
      { action: "remove", target },
    ]);
    assert.deepEqual(
      listed.map((change) => [change.action, change.target]),
      [["remove", target]],
    );
  });
});

describe("a group's own color", () => {
  const ROOTED = `dtg: 1
modes: [light, dark]
palette:
  gray:
    $root: "#888888"
    50: "#fafafa"
roles:
  label:
    $root: [gray, gray.50]
    secondary: [gray.50, gray]
  echo: [label, gray]
`;

  test("is edited at the group's path", () => {
    const edited = applyEdits(ROOTED, [
      { action: "set", target: { kind: "ref", section: "roles", role: "label", mode: 1 }, value: "gray" },
      { action: "set", target: { kind: "constant", path: "gray" }, value: "#777777" },
    ]);
    assert.ok(edited.includes("    $root: [gray, gray]\n"));
    assert.ok(edited.includes('    $root: "#777777"\n'));
  });

  test("moves with its group, refs and all", () => {
    const edited = applyEdits(ROOTED, [
      { action: "rename", target: { kind: "group", root: "palette", path: "gray" }, name: "neutral" },
      { action: "rename", target: { kind: "group", root: "roles", path: "label" }, name: "text" },
    ]);
    assert.ok(edited.includes("    $root: [neutral, neutral.50]\n"));
    assert.ok(edited.includes("  echo: [text, neutral]\n"));
    assert.equal(resolveDefinition(edited).problems.length, 0);
  });

  test("is not renamed apart from its group", () => {
    assert.throws(
      () => applyEdits(ROOTED, [{ action: "rename", target: { kind: "role", section: "roles", path: "label" }, name: "primary" }]),
      /its group's own color, renamed with the group/,
    );
  });
});
