# Working with dtg

dtg keeps a project's colors as a definition: the palette (picked colors),
systems (algorithms that generate steps), and roles (named decisions, one
color per mode). The generated CSS, Tailwind, SCSS and DTCG files are outputs.
This guide is what a power user knows on top of the README; for the grammar
itself, read `node_modules/@fifthrevision/dtg/README.md`, and for flags,
`npx dtg --help`.

Sections: How to work · Names · Converting an existing color system ·
Modes · Algorithms and tuning · Contrast across modes · Translucency ·
Roles that stay maintainable · Keeping public names stable · Gradients,
wide gamut, sharing. Read How to work and Names, then the one your task is.

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
- When the person can't be asked, do what leaves the output the same or what
  they asked for exactly, and end with each decision you left open: what you
  would show them in the editor, and the question.

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
- `alias` renames one segment of a name, `omit: true` drops one (on a role,
  a role group or a palette group). Refs always use the definition's own
  names.
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

## Modes: dark, high contrast, themes

- A mode with no `extends` names every color. A mode that `extends` another
  says only what differs: the role's list may stop early, and `~` holds the
  place of a mode that says nothing. `dark-hc: { extends: dark }` plus
  `border: [sky(12), night(16), night(40)]` changes only the border in
  `dark-hc`; every role that doesn't mention it takes dark's ref.
- An extending mode copies the ref, not the color, and resolves it again in
  its own mode. So repointing one role in `dark-hc` moves every role that
  points at it there too. Use that: point roles at roles (`raised:
  [surface.card, ...]`) so a variant mode overrides a handful of roots.
- Set `scheme: light | dark` on every root mode. That needs the map form;
  `modes: [light, dark]` becomes `modes: { light: { scheme: light }, dark:
  { scheme: dark } }`, with the same order. It becomes `color-scheme`
  in the CSS, so form controls and scrollbars match, and the editor picks its
  background from it. It's never read off the mode's name.
- In the CSS the first mode is `:root` and every other mode is a class
  (`.dark`), which also selects its extending modes (`.dark, .dark-hc`). What
  puts `.dark` on the page is the app's job. If the app switches by
  `[data-theme]` or a media query, either change the app or use
  `modes: flat` on the output and map the variables yourself.
- A mode is for colors one page switches between at runtime. A brand or
  theme that ships as its own build, with different anchors but the same
  roles, is better as its own definition built separately
  (`dtg build --definition brand-b.dtg.yaml --css ...`); a definition holds one
  set of systems, and modes only change which refs roles take.

## Algorithms and tuning

The README says what each does; this is how to steer them.

- `tint`: the step is the ink's percent over the base, so the number reads
  as the recipe (`sky(12)` is 12% ink). Retune the whole ramp by moving
  `base` or `tint`; move one use by changing the number in the role. Steps
  can be fractional (`sky(3.5)`).
- `curve`: change the anchor to recolor a ramp, keep the shape. Shape lives in
  `lightness`, `chroma` and `hue` curves; edit them by dragging in the editor,
  where every step redraws live, rather than by guessing numbers. Shared
  shapes go in `defaults: { curve: { lightness: ... } }`, so every hue moves
  together and each system is just `anchor:`.
- `overlay`: one color at an opacity, never flattened. For shadows and
  scrims, over things you can't predict.
- `tone`: the step is lightness itself (CIELAB L*), so the same step is
  equally light in every palette. Reach for it when contrast has to hold
  across hues; see below.
- `scale`: a base at 500 between two end colors you pick; `midpoint` bends
  it. For when the ends are the point.
- `overrides` pin a flattened step to an exact color; the recipe still
  drives every other step. More than a couple per system means the params
  are wrong.
- `publish: [50, 500, 950]` on a system publishes steps no role uses yet,
  for an app that reads the ramp directly.

## Contrast across modes

dtg doesn't check contrast, so check pairs that carry text yourself: compute
the WCAG ratio, `(L1 + 0.05) / (L2 + 0.05)` from relative luminance, on the
built values in every mode (build to a scratch path and follow the `var()`s).
Body text wants 4.5:1, large text and icons 3:1.

- Which pairs: every text and icon role against every surface role it can
  sit on, in every mode. Borders that are the only edge of a control want 3:1
  too.
- When one fails, move the role to a step that passes: the next step of the
  same palette group or system, before adding a new color. Say what moved; a
  heavier muted text is a design change the person should see.
- With `tint` on a known ground, contrast follows the percent: a label at
  `sky(62)` over a canvas at `sky(3)` is the same pair whatever else moves.
  Pick label steps by checking them against the surface they sit on, in each
  mode, and keep the dark ramp's numbers mirroring the light one's.
- `tone` makes contrast a property of the step: tone 40 is about 6.5:1
  against white and tone 50 about 4.5:1, for any hue. Material's example
  (`npx dtg init --from material`) pairs `primary(40)` with `on-primary`
  `primary(100)`, and `primary(80)` with `primary(20)` in dark, so swapping
  the source color can't break a pair.
- Translucent colors have no contrast of their own; check them flattened
  over the surface they sit on.

## Translucency

Four ways, and they mean different things. An overlay meant to work on any
background is still one per mode: dark ink over light grounds, light ink
over dark ones (`[transparent(black 10), transparent(white 12)]`).

- `sky(15)`: flattened. A solid color, 15% ink over the ramp's base. Right
  when the ground is known: surfaces, separators, text.
- `sky(15 tint)`: the same ink at 15% opacity, not flattened. Right for
  something that sits on top of other colors, like a hover state, and that
  should look like `sky(15)` where it lands on the base. Twins are written
  as sibling roles (`hover`, `hover-flat`).
- `shadow(40)` from an `overlay` system: a named family of opacities of one
  color. Right for shadows and scrims, published together.
- `transparent(white 70)`: any color at an opacity, written out as a value.
  It doesn't publish what it wraps, and it multiplies an alpha the color
  already has. Right for one-off veils, for fading a gradient, and for any
  of the above in a project with no systems yet.

## Roles that stay maintainable

- Name a role for its use (`surface.card`, `label.secondary`), never its
  look (`gray-light`). Collections and groups are free; split by use.
- Point roles at roles when one is defined in terms of another
  (`floating: [surface.card, night(6)]`), so a change lands once.
- A literal in a role is fine once. Written twice, it wants a name.
- When several roles read from one family of colors, that family is a system
  trying to be born: move it into one and point the roles at its steps.
- Use `description` on a role, group or system for anything a reader needs
  that the name doesn't say; DTCG carries it to Figma.
- After any restructuring, `dtg compare` the generated file: same colors,
  same names.

## Keeping public names stable

- Renaming in the editor rewrites every ref to the renamed color, role or
  system in one step. By hand, rename the key and every ref yourself; the
  build fails on any you miss.
- A rename changes the published name. To change the internal name and keep
  the public one, add `alias: <old name>` to it; to drop a segment from every
  name below it, `omit: true`.
- Steps appear and disappear with demand: a step nothing points at stops
  being published. If the app reads a step directly, list it in the system's
  `publish`.
- DTCG gives every color an id that survives renames, so Figma syncs rename
  variables instead of making new ones. Say what changed in the definition's
  `changelog` (`- 2026-11-20: renamed surface.base to surface.canvas`); it
  travels with the DTCG file to whoever syncs it.

## Gradients, wide gamut, sharing

- A gradient used in more than one place goes in the palette by name
  (`dawn: gradient(hues.brand 0% white 100% angle=180deg)`); a role restyles
  it with `gradient(dawn angle=135deg)`. A role that is a gradient must be
  one in every mode. In `tailwind` output a gradient role gets a
  `bg-<role>` class, not a color utility.
- Colors past sRGB are written twice in CSS: mapped into sRGB, then again at
  full strength in an `@supports` block. `gamut` in the config is the
  widest the project means to use; past it, the build warns. DTCG writes one
  color space (`outputs.dtcg.colorSpace`), which must match the Figma file's.
- `npx dtg docs --out <dir>` writes the editor as static files, for showing
  the system to someone without dtg; `--editable` lets them try changes in
  their browser.
- For Figma, build a `dtcg` output and sync from it; the file's
  `$extensions` tell an agent how. The Figma document's color profile has to
  be set by hand to match first.
