# Working with dtg

dtg keeps a project's colors as a definition: the palette (picked colors),
systems (algorithms that generate steps), and roles (named decisions, one
color per mode). The generated CSS, Tailwind, SCSS and DTCG files are outputs.
This guide is what a power user knows on top of the README; for the grammar
itself, read `node_modules/@fifthrevision/dtg/README.md`, and for flags,
`npx dtg --help`.

## How to work

- Find the definition through `dtg.config.yaml` (`definitions:`). There is no
  default location. A project with no config yet needs one; write it by hand
  (`definitions: <file>` and an `outputs` entry) rather than running
  `dtg init`, which asks questions. Never edit a generated file; its header
  says so, and the next build overwrites it.
- The unit of change is one line of the definition, then a rebuild. If what
  you're asked for can't be said as a small edit, say so before writing a lot.
- `npx dtg build` overwrites the files the app ships. To see what an edit
  does without writing anything, run `npx dtg compare <the generated CSS>`:
  it lists every color that would move, in every mode, and every variable
  that would appear or disappear.
- A refactor (moving colors into a system, regrouping roles, pointing roles
  at roles) should leave the output the same. `dtg compare` against the
  current generated file should report nothing moved and no names gained or
  lost. Anything it does report, you have to be able to explain.
- Read warnings (`build` and `compare` both print them) and act on them: a
  literal written twice wants one name, a palette color or one role pointing
  at the other; a color past the project's `gamut` will be mapped into it.
- The person judges color, not you. After any visual change, have
  `npx dtg edit` running (it reloads on file changes) and point them at the
  page that shows it: a system's page for a ramp, a collection's page for
  roles side by side across modes. Don't call a palette or ramp good from
  the numbers alone.

## Names

What the app reads is decided by these rules, and most mistakes come from
guessing them:

- The `css` output names every color as the definition does. A palette color
  `gray.500` is `--gray-500`, a system step `sky(10)` is `--sky-10` (and
  `sky(4.5)` is `--sky-4_5`), a role `surface.card` is `--surface-card`. A
  collection is any top-level key other than dtg's own, and its name never
  appears.
- Keys can hold hyphens: a role `bg-subtle` is `--bg-subtle`. For `--bg` next
  to `--bg-subtle` as a group, give the group a child that drops its own
  name: `bg: { base: { omit: true, refs: [...] }, subtle: [...] }`. Flat keys
  (`bg`, `bg-subtle`) work too.
- The `tailwind` output (for a Tailwind v4 build, instead of `css`) puts
  palette colors and steps behind `--color-` (`--color-gray-500`), which is
  what makes `bg-gray-500`, and wires each role in as a utility too.
- `alias` renames one segment of a name, `omit: true` drops one. Refs always
  use the definition's own names.
- A palette color, a step and a role can't publish the same name; the build
  says which two collide.
- A palette color is published unless its group says `publish: false`. Put
  colors that only feed systems (anchors, tint ends) in such a group. A role
  pointing at one still publishes it, since the role's `var()` needs it;
  `transparent()` around one doesn't, since it writes the value out.

## Converting an existing color system

The goal is a definition the app can switch to with a diff you can account
for, not one that only looks similar. Work in two passes, and run
`npx dtg compare <old stylesheet>` after each: it reads the old file, follows
every `var()` to its color, mode by mode, and lists what moved (OKLab ΔE)
and what only one side has.

**First, Tailwind or not.** Look for `@import "tailwindcss"`, `@theme`, or a
`tailwind.config`. On Tailwind v4 the output is `tailwind:`, and the names
the app reads are `--color-*`; otherwise it's `css:`.

**Pass 1: literal.** Inventory every color source: CSS variables, Sass,
a Tailwind config, a JS theme. Record each name, its value in each mode, and
where it's used. Then write them as they are:

- Primitives (shades, brand colors) go in `palette`, under the names the app
  reads: `--gray-500` is `gray: { 500: "#7c808a" }`.
- Semantic variables (`--text-muted`, `--bg`) become roles in a collection,
  one ref per mode in `modes` order, pointing at palette colors where the old
  file used `var()`.
- Translucent values are literals too. A definition takes the spaced
  spelling, `rgb(232 83 63 / 0.25)`; rewrite each `rgba(232, 83, 63, 0.25)`
  by hand (dtg refuses commas and says the spelling it wants, and writes
  commas again in its output). Or name the ink in the palette and write
  `transparent(brand 25)`.
- Quote any ref with a hex color in it, whole: `"transparent(#111827 8)"`.
  YAML reads a space then `#` as a comment.
- A project written in hex is sRGB: set `gamut: srgb` in `dtg.config.yaml`.

It looks like this:

```yaml
dtg: 1
modes: [light, dark]

palette:
  gray: { 50: "#f8f8fa", 500: "#7c808a", 900: "#111827" }
  brand: "#e8533f"

theme:
  bg: ["#ffffff", "#0d1117"]
  bg-subtle: [gray.50, "#161b22"]
  card: [bg, "#1c2129"]
  text: [gray.900, "#f0f3f6"]
  text-muted: [gray.500, "#8b949e"]
  selection: [transparent(brand 25), transparent(brand 35)]
```

Pass 1 should compare with nothing moved. It's the checkpoint you can fall
back to. If the person can't be asked anything, stop here and list what
Pass 2 would turn into systems.

**Pass 2: find the systems.** Look for colors that are really one recipe:

- Neutrals stepping from a background toward an ink → `tint`, with `base`
  as the background and `tint` as the ink. Each old shade's percent can be
  solved for per channel, `(shade − base) / (tint − base)`. When the three
  channels disagree, the shade wasn't a pure tint; take the closest, then
  measure. Dark neutrals are usually a tint of their own, from the dark
  background toward the light ink, not the light one reversed.
- One ink at several opacities (a selection color, a code background, hover)
  → `overlay`.
- Numbered hue ramps (50–950) → `curve`, anchored on the shade that was
  actually picked (the brand color, or the step the app uses most), with `at`
  set to that step. `curve` has its own `gamut` param, `display-p3` unless
  set; in an sRGB project set `gamut: srgb` on it too. If the ramps share a
  shape, as Tailwind's do, fit one and move its curves into `defaults`, so
  each hue is just an anchor.
- Ramps between two chosen end colors → `scale`. Material-style tonal
  palettes, or a contrast requirement per step → `tone`.

A system changes names when its steps aren't the old ones: a `tint` step is
named by its percent (`--gray-55`, not `--gray-500`). `curve` keeps 50–950.
Worse, the numbers can overlap with different meanings: a tint named `gray`
would publish `gray(100)`, its darkest ink, as `--gray-100`, where the old
`--gray-100` was near-white. Name a tint apart from the ramp it replaces
(`neutral`). If the app reads the old primitive names directly, moving them
into a system means either moving those call sites onto roles, or keeping
that ramp in the palette. That's the person's decision; ask.

**Fit, don't copy.** Measure each replaced shade with `dtg compare`. Under
about 0.02 is below what people notice: accept it, since that drift is the
hand-noise a system is meant to absorb. Pin a step with `overrides` when the
exact value is a requirement (a brand-mandated hex).

Fitting a `curve` to an existing ramp takes a search: write a short script
that edits `from`/`to` in a scratch copy of the definition and scores it with
`npx dtg compare <old> --definition <copy>`. Fit `from` and `to` only, and
stop there; leave easing alone. Then don't settle it yourself. Show the
person both in the editor: that curve with its worst steps pinned or
accepted, and the ramp left in the palette as picked. A system is worth it
when they want to own and adjust the ramp from now on; a palette is worth it
when the exact colors are the point.

**Account for the diff.** The last `dtg compare` against the old stylesheet
should leave nothing you can't explain. Every difference falls into one of:

- colors only in the old file, gone because nothing points at them anymore
  (list them; publish them if the app still reads them)
- hand-tunes kept as `overrides`
- drift the system absorbed, each one under the ΔE you accepted

Anything else is a defect in the definition. Show the person the system
pages before calling the conversion done.
