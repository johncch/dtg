# Working with dtg

dtg keeps a project's colors as a definition: the palette (picked colors),
systems (algorithms that generate steps), and roles (named decisions, one
color per mode). The generated CSS, Tailwind, SCSS and DTCG files are outputs.
This guide is what a power user knows on top of the README; for the grammar
itself, read `node_modules/@fifthrevision/dtg/README.md`, and for flags,
`npx dtg --help`.

## How to work

- Find the definition through `dtg.config.yaml` (`definitions:`). There is no
  default location. Never edit a generated file; its header says so, and the
  next build overwrites it.
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
- Read build warnings and act on them: a literal written twice wants a palette
  name; a color past the project's `gamut` will be mapped into it.
- The person judges color, not you. After any visual change, have
  `npx dtg edit` running (it reloads on file changes) and point them at the
  page that shows it: a system's page for a ramp, a collection's page for
  roles side by side across modes. Don't call a palette or ramp good from
  the numbers alone.
- The editor's palette page is a color tool in its own right: randomize,
  harmonize around a base, drag in a hue/chroma plot. Send the person there
  for picking, instead of proposing hexes.

## Names

What the app reads is decided by these rules, and most mistakes come from
guessing them:

- The `css` output names every color as the definition does. A palette color
  `gray.500` is `--gray-500`, a system step `sky(10)` is `--sky-10`, a role
  `surface.card` is `--surface-card`. A collection's name never appears.
- The `tailwind` output (for a Tailwind v4 build, instead of `css`) puts
  palette colors and steps behind `--color-` (`--color-gray-500`), which is
  what makes `bg-gray-500`, and wires each role in as a utility too.
- `alias` renames one segment of a name, `omit: true` drops one. Refs always
  use the definition's own names.
- A palette color, a step and a role can't publish the same name; the build
  says which two collide.
- A palette color is published unless its group says `publish: false`. Put
  colors that only feed systems (anchors, tint ends) in such a group. A role
  pointing at one still publishes it, since the role's `var()` needs it.

## Converting an existing color system

The goal is a definition the app can switch to with a diff you can account
for, not one that only looks similar. Work in two passes, and run
`npx dtg compare <old stylesheet>` after each: it reads the old file, follows
every `var()` to its color, mode by mode, and lists what moved (OKLab ΔE)
and what only one side has.

**Pass 1: literal.** Inventory every color source: CSS variables, Sass,
a Tailwind config, a JS theme. Record each name, its value in each mode, and
where it's used. Then write them as they are:

- Primitives (shades, brand colors) go in `palette`, under the names the app
  reads: `--gray-500` is `gray: { 500: "#7c808a" }`. Check whether the project
  is on Tailwind; that decides `css` or `tailwind` in the config, and so which
  names come out.
- Semantic variables (`--text-muted`, `--bg`) become roles in a collection,
  one ref per mode in `modes` order, pointing at palette colors where the old
  file used `var()`.
- Translucent values are literals too: `rgb(232 83 63 / 0.25)`, with spaces
  as CSS writes it now; dtg refuses commas and says the spelling it wants. Or
  name the ink in the palette and write `transparent(brand 25)`.
- Quote any ref with a hex color in it, whole: `"transparent(#111827 8)"`.
  YAML reads a space then `#` as a comment.
- A project written in hex is sRGB: set `gamut: srgb` in `dtg.config.yaml`.

Pass 1 should compare with nothing moved. It's the checkpoint you can fall
back to.

**Pass 2: find the systems.** Look for colors that are really one recipe:

- Neutrals stepping from a background toward an ink → `tint`, with `base`
  as the background and `tint` as the ink. Each old shade's percent can be
  solved for per channel, `(shade − base) / (tint − base)`. When the three
  channels disagree, the shade wasn't a pure tint; take the closest, then
  measure.
- One ink at several opacities (a selection color, a code background, hover)
  → `overlay`.
- Numbered hue ramps (50–950) → `curve`, anchored on the shade that was
  actually picked (the brand color, or the step the app uses most), with `at`
  set to that step. If the ramps share a shape, as Tailwind's do, fit one and
  move its curves into `defaults`, so each hue is just an anchor.
- Ramps between two chosen end colors → `scale`. Material-style tonal
  palettes, or a contrast requirement per step → `tone`.

A system changes names when its steps aren't the old ones: a `tint` step is
named by its percent (`--gray-55`, not `--gray-500`). `curve` keeps 50–950.
If the app reads the old primitive names directly, moving them into a
system means either moving those call sites onto roles, or keeping that ramp
in the palette. That's the person's decision; ask.

**Fit, don't copy.** Measure each replaced shade with `dtg compare`. Under
about 0.02 is below what people notice: accept it, since that drift is the
hand-noise a system is meant to absorb. Pin a step with `overrides` when the
exact value is a requirement (a brand-mandated hex).

Some hand-picked ramps only fit a `curve` with heavily shaped easing, found
by a search over many builds. Don't settle that yourself. Show the person
both in the editor: the simplest curve (`from`/`to` only) with its worst
steps pinned or accepted, and the ramp left in the palette as picked. A
system is worth it when they want to own and adjust the ramp from now on; a
palette is worth it when the exact colors are the point.

**Account for the diff.** The last `dtg compare` against the old stylesheet
should leave nothing you can't explain. Every difference falls into one of:

- colors only in the old file, gone because nothing points at them anymore
  (list them; publish them if the app still reads them)
- hand-tunes kept as `overrides`
- drift the system absorbed, each one under the ΔE you accepted

Anything else is a defect in the definition. Show the person the system
pages before calling the conversion done.
