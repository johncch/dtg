# Project algorithms

**Status: the contract is built, loading is not.** Settled in conversation
with Chong Han on 2026-10-12. The built-ins are written in the shape below and
the resolver takes extra algorithms; nothing loads a project's files yet,
and there is no toolkit. Read `how-this-works.md` first for the contract.

## Why

Algorithms are compiled into dtg, so a color recipe only one project needs
has to ship to every project. `blend` was the case in hand: fifthrevision's
whole definition was five `blend` systems, nothing else used it, and it was the
only algorithm that ever used the old tuner's controls. (On 2026-10-16 it was
removed instead of moved — a group of tints does the same — so this design
waits for its next real case.) How a recipe
generates colors, and how it is edited, are often specific to one app.

A project should be able to keep its own algorithms beside its definition,
and dtg should draw the editing controls for them without the project writing
any interface code.

## The shape

### In `dtg.config.yaml`

```yaml
algorithms:
  - src/styles/algorithms/blend.js     # a path, relative to dtg.config.yaml
  - "@acme/dtg-algorithms/duotone"     # or a package name
```

An entry is a file path or a package name. Nothing is inferred: no naming
convention, no directory scanning, no prefix added. ESLint spent years
undoing name-based plugin lookup; this starts where it ended up.

### The algorithm file

```js
// no imports
export default ({ mixIn }) => ({
  name: "blend",
  description: "A base color and several named colors to blend toward…",

  params: {
    base:   { kind: "color" },
    toward: { kind: "map", of: { kind: "color" } },
    space:  { kind: "choice", options: ["srgb", "oklab", "display-p3"], default: "srgb" },
  },

  preview: { shape: "palette" },

  selector: (params) => ({
    fields: [
      { name: "color", kind: "choice", options: Object.keys(params.toward) },
      { name: "weight", kind: "number", min: 0, max: 100 },
    ],
    forms: ["alpha"],
  }),

  resolve({ color, weight, form }, params) {
    const toward = params.toward[color];
    if (form === "alpha") return { ...toward, alpha: weight / 100 };
    return mixIn(toward, params.base, weight / 100, params.space);
  },
});
```

The default export is a function. dtg calls it with a **toolkit** — the color
arithmetic it chooses to expose — and gets the algorithm back.

### Loading

`emit` and `dev` both load the listed modules before resolving, call each
default export with the toolkit, and pass the result to `resolveDefinition`
as its registry. The dev server watches the files and, on a change, imports
them again, re-resolves, and tells the browser.

- A name defined twice is an error.
- A name that replaces a built-in is a warning. Shadowing is allowed, and
  easy to do by accident.

## Decisions, and why

**The toolkit is handed in, not imported.** An algorithm file that began
`import … from "@fifthrevision/dtg"` would only load where dtg is installed
in the project's own `node_modules`. dtg is also run through `npx` and from a
global install, and from projects with no `package.json` at all — a Python or
Rails app uses it the way it would use Prettier. Node resolves an import from
the importing file's folder, so in those projects the import fails. Handing
the tools in removes module resolution from the picture. It also guarantees
an algorithm uses the arithmetic of the dtg that is running it, never a
second copy at another version, and it makes the public surface exactly one
object. This is how ESLint rules get `context` and Tailwind plugins get
`addUtilities`. The cost is editor types, which a project that does install
dtg locally can recover with a type comment.

**Algorithms are JavaScript, whatever the project is written in.** dtg runs
them. An algorithm in another language would need dtg to call out to another
program; that is not planned.

**The algorithm declares what is editable; dtg draws it.** `params` says what
each param is — a color, a number in a range, a choice, a map or list of
those. dtg validates against it, knows which params are colors, and draws the
picker, slider or dropdown. The alternative, letting a project ship its own
interface code, would mean bundling project React into dtg's app and making
every internal of that app something projects depend on. Storybook's controls
are the model: a component declares `argTypes`, Storybook draws them, and a
missing control type gets added to Storybook for everyone. The limit is the
same too — a project gets only the kinds of control and preview dtg knows.
When one is missing, add it to dtg.

**The algorithm declares its selector; dtg writes it.** `selector` says what
a ref into the system is made of — its fields and forms — and dtg owns how
that is spelled, what it emits as, and how steps sort. An algorithm that
parsed its own selector text could be read by dtg but not explained, drawn
as a control, or written back by an editor. The limit is the one `params`
has: a selector dtg's field kinds cannot express means adding a kind to dtg.

**Params arrive parsed.** dtg has to parse every color to validate it, so it
hands the result on: a hook sees colors, not strings, with defaults filled.

**The definition stays data.** Describing algorithms as YAML recipes was
considered and rejected: it means designing a small language, and the
definition is not supposed to compute. Code lives in the algorithm file,
which is version-controlled beside the definition.

**Determinism becomes the project's to keep.** Same definition, same bytes is
still the rule. dtg cannot enforce it on code it does not own; an algorithm
that reads the clock or the network breaks it for that project.

**One contract.** The built-ins get rewritten in this shape. There is not an
old contract kept alongside a new one.

## Open

- **The kinds in `params`.** Color, number, choice, map and list cover every
  built-in. This is the part most likely to need another kind when a third
  project arrives.
- **How a system's page is laid out.** Not designed, on purpose. The
  direction (Chong Han, 2026-10-12): an algorithm names prebuilt components dtg
  ships — something like `layout: () => [grid, gradient]` — and never brings
  its own. Fifthrevision's `blend` is the case to design it against: its
  four anchors only read as a gradient. It would be returned as plain data,
  since the algorithm runs in Node and the page in the browser, and
  `preview.shape` is expected to fold into it. Nothing in the contract is in
  its way: it is one more optional field.
- **What the toolkit contains.** Small on purpose. Start from what `blend`
  and the built-ins use from `color-math.ts` and add on demand.
- **TypeScript files.** `.js` loads on every Node version dtg supports;
  `.ts` loads directly only on recent ones. Promise `.js`.
- **A self-contained dtg.** A single program with no Node requirement would
  help non-JavaScript projects. Algorithm files in the shape above would
  still load in it. Not planned, not ruled out.

## How to prove it

Move `blend` out of dtg and into fifthrevision as the first real case:

1. ~~Define the new contract; rewrite the built-ins in it.~~ Done, without
   the toolkit: the built-ins still import `color-math.ts`.
2. Define the toolkit. Add `algorithms:` to `dtg.config.yaml`; load it in `emit` and `dev`.
3. Move `blend` into fifthrevision.
4. Accept when fifthrevision's generated CSS is byte-for-byte unchanged. It
   already has a parity script.

That settles what is public, how files load, and how the dev server reloads
them against a real consumer rather than a guess. The working copy for color
edits does not depend on any of this; the editor for non-color params does,
so the contract should be settled before that part is built.
