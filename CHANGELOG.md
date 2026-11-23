# Changelog

## Unreleased

- Editor UI improvements on a system's page:
  - A profile of the ramp beside its params: lightness, chroma and hue across
    the steps, measured from the colors the system makes, with the published
    steps as dots and the sRGB and P3 chroma limits as dashed and dotted lines.
    It follows a param as you drag it. Tone plots lightness as L\*, and overlay
    plots only opacity.
  - The page is two rows of boxes, Params beside Profile and Preview step beside
    Published steps, then the steps table.
  - A param's name shows what it does on hover, and so does each of a step's
    fields in Preview step. Each algorithm's description says what it makes and
    what its step means.
  - A param from the `defaults` block is marked `defaults`, where it said
    `shared`, and a built-in value is no longer marked at all. Its panel says
    where an edit goes: Unlink copies a `defaults` value onto the system to edit
    it there, and Reset to defaults or Reset to built-in removes the system's
    own value.
  - The steps table marks a step listed in `publish` as `publish`.
- `scale`'s `midpoint` and `hueShift` can each be a pair, `[light, dark]`, to
  shape the two halves of the ramp apart; one number still means both. The
  editor always shows both ends and writes the shortest form.
- `curve` and `tone` are no longer experimental. Their params change from now on
  only the way every other algorithm's do, with the old spelling still read or
  refused with its replacement.
- `emit` is now spelled `publish`: `publish: false` on a palette group, and
  `publish: [50, 500]` on a system. `emit` still works and means the same;
  writing both on one block is an error. The editor keeps whichever one a file
  has and writes `publish` where there is neither. Opening a definition that
  still writes `emit` offers rewriting it as `publish` as an unsaved change,
  which Save writes and Discard drops.
- The editor has an Export window, the download button by the title, that copies
  or downloads the definition as CSS, Tailwind, SCSS or DTCG, unsaved edits
  included. It works in a copy written by `dtg docs` too.
- The Settings page is Modes, and it edits the definition's modes. A double
  click renames one: every `extends` naming it follows, and its editor
  background moves with it on Save. Its scheme is a select. Each mode can be
  extended, adding a mode that says only what differs; duplicated, adding a mode
  of its own that starts with every role's ref from the original; or removed,
  taking its place out of every role's refs and its editor background with it on
  Save. A mode another extends stays until that one is pointed elsewhere, and so
  does the last mode. These are unsaved changes like any other. A
  `modes: [light, dark]` list is written as a map once a scheme or a new mode
  needs one; a definition without `modes` gets one, naming its one mode
  `default`, with each role's ref written as a list.
- Collections can be added, renamed and removed in the editor. New collection,
  at the bottom of the sidebar, adds one empty; the settings button on a
  collection's page renames it or removes it with its roles, which is refused
  while roles elsewhere point into it. An empty collection shows in the sidebar,
  and its page adds its first role, so a collection's last role can be deleted
  too.
- An empty definition file opens in the editor, where it crashed, and a
  definition can be built from nothing there: the first palette color, system or
  role writes the `palette`, `systems` or collection block it goes in. Saving
  writes `dtg: 1` into a definition that lacks it, and a missing `dtg:` no
  longer warns.
- `dtg edit` in a folder with no `dtg.config.yaml` offers to set up a project,
  asking what `dtg init` asks, then opens it. Without a terminal to ask in, it
  says to run `dtg init`, as before.

## [0.5.0] - 2026-11-20

- A hex color can carry an alpha, as CSS writes it: `#rrggbbaa` or `#rgba`.
  `"#00000080"` used to be refused; it is black at about 50%. The editor writes
  a translucent color sRGB holds that way too, where it used to switch to
  `oklch(… / a)`; a color outside sRGB is still `oklch()`.

- A number in a selector is one step however it is written: `sky(3.0)` and
  `sky(03)` are `sky(3)` and emit `--color-sky-3`. They used to emit a second
  variable, `--color-sky-3_0`, with the same color.
- A role can be a gradient: `gradient(paper 0% sky(500) 100% angle=90deg)`,
  colors, each with an optional position, then named arguments: `angle`, or
  `kind=radial` and `kind=conic` with `x`, `y`, `shape` and `size`, and `repeat`
  and `space`. A stop is any ref that resolves to a color, and the CSS keeps its
  reference. Plain CSS, Sass and DTCG write it. The `tailwind` format gives a
  gradient role a `bg-<role>` class that sets `background-image`, where a color
  role is wired into the theme. `transparent()` takes a gradient too, and fades
  every stop. A gradient written in the palette is named and reusable: it emits
  as `--gradient-<name>`, a role points at it by path, and
  `gradient(name angle=135deg)` restyles it, keeping its stops. The editor draws
  it where it is written, among the palette's colors, marked as left out of
  Randomize, Harmonize and the plot. In the editor a ref's sources gain
  Gradient: a ruler with a handle per stop to drag, a row per stop opening the
  usual color editor, then its kind, angle or center, shape and size, and
  repeat. A role that is a gradient in one mode and a color in another loads and
  draws, marked on its row, and neither saves nor builds until it is one or the
  other.
- `transparent()` takes any ref that resolves to a color, not only a palette
  color: a step (`transparent(sky(500) 70)`), a literal, or another role, which
  it follows mode by mode. It emits as its value and publishes nothing by
  itself, so a palette color in an `emit: false` group that is used only through
  `transparent()` is no longer written out.
- Palette groups gain two circular views: a 2D hue/chroma disk and a
  fixed-camera 3D view adding lightness as height. Hue runs clockwise from the
  top. Switching views smoothly tilts the disk and raises or lowers the color
  dots, preserving selection; reduced-motion preferences skip the animation.
  Chroma increases outward, with neutrals at the center. Stems connect 3D points
  to their positions on the base disk. The disk uses a fixed reference
  lightness; points retain their actual colors. Dragging edits hue/chroma in 2D,
  preserving lightness; vertical dragging edits lightness in 3D, preserving
  hue/chroma. Swatches keep the original picker. Overlap badges let every color
  be selected. Double-click empty disk space (the base disk in 3D) to add at
  that hue/chroma, using the selection's lightness or the palette median. A
  locked color cannot be dragged, randomized or removed, and clicking it shows
  its values with an Unlock button where the picker would be. Edits use the
  usual undo and save. A sidebar on the right opens and closes with the settings
  button at the top right, and also closes with × or Escape. It holds the
  visualization, its view controls, Randomize's style and Harmonize in a
  scrolling area. Randomize sits beside the toggle. The + button beside the
  swatches is gone: hovering between two colors, or past the last, shows a +
  that adds a color at that place. Dragging a color's handle, or pressing Left
  or Right on it, moves the color within its group, in the definition too. A
  layout control beside the toggle shows the palette three ways, kept per
  browser. Strip fills the page down to the bottom of the window, with each
  color's controls, value and name drawn on the color; Grid is separate squares
  with the controls on the square and the value and name beneath; List is a
  table of path and value, as on the page of all colors. The value is the color
  as the definition writes it, with the name under it. A color is made the base
  with its Set base control, shown at the top left on hover in Strip and Grid,
  or by double-clicking its dot; setting one opens the sidebar. Randomize rolls
  any color, or with its Style set, any hue at the base color's lightness and
  chroma. Harmonize moves the unlocked colors' hues onto a scheme around the
  base (analogous, complementary, triad, evenly spaced), keeping each color's
  lightness and chroma. The base is the selected color, or the first locked one.
  Each is one undo step.

- The editor adds, renames and removes systems, roles, role groups and palettes,
  not only colors. Nothing is written until you save.
  - Systems: the + beside Systems adds one; a system's page changes its name or
    algorithm, or removes it. Its `emit` list is edited in Params as
    comma-separated steps, and a step's "Used by" says `emit` when the list
    publishes it.
  - Roles: every roles table ends each group with "New role". A row's name is
    renamed by double-click, dragged by its handle to reorder, copied with the
    duplicate button, and removed with the trash once nothing points at it.
    The + beside a section adds a group.
  - Palette: the + beside Palette adds a palette. The page of all colors adds,
    renames, reorders, duplicates and removes the colors in no group, and a
    palette's List layout does the same for its own, with a lock per color.
  - Names are dotted paths. Retyping `surface.canvas` as `label.canvas` moves
    the role to that group, writing a group that is not there; colors move
    between palettes the same way. Every ref, `transparent()` and color param
    follows.
  - A group or palette is renamed from the title of its page, and every ref into
    it follows. A group is written with its first entry and goes with its last.

- The editor's panels (the color picker, rename, the ref editor) open beside the
  pointer where you clicked, not below the thing clicked. Opened from the
  keyboard, a panel still opens below its button.

- The value editor:
  - Its sources are a row of icons along the top, as a design tool marks a fill:
    Solid color, Gradient, Palette, Systems and Roles, with Inherit first on a
    mode that extends another.
  - Functions, after them, wraps whatever the source chose in `transparent()`
    with an opacity, solid colors included. It replaces the transparent checkbox
    that only Palette had.
  - Solid color has alpha: a bar under the hue bar and a percent field beside
    it. Steps moved to the top right, Display P3 is listed as P3, and each
    number field names itself on hover.
  - Choosing a palette color or a role no longer closes the panel.
  - The ← reset shows only where the value was a solid color.
  - A value that is refused says why in the panel, in a few words, and closing
    the panel drops it.

- Tables and pages:
  - A row's controls (lock, copy, delete) have a column of their own beside its
    name, so a narrow table no longer breaks names letter by letter.
  - The page of all colors edits every group's colors, not only the ones in no
    group: each group ends with New color, which adds the color the group's own
    page would. Under a group's heading a row shows the last part of its name.
  - In a palette's Grid and Strip, a color is renamed by double-click, as in a
    table, which can also move it to another palette; it can no longer be
    deleted while something uses it.
  - "Used by" no longer marks a use as translucent.
  - A refused edit shows as an alert box on every page and panel.

- The sidebar nests palette groups like role groups, with each group's
  description on hover. Below 900px wide (it was 640px) it becomes a bar across
  the top with a menu button that opens the navigation.

- A role can hold a color directly: `surface: "#000000"` or `oklch(0 0 0)`. It
  emits as a value, not a reference, and the editor's role picker gains a Solid
  color source to choose one. dtg warns when the same color is written twice or
  matches a constant. Systems can no longer be named `oklch`, `oklab` or
  `color`.

## [0.4.0] - 2026-10-22

### Start here

- `dtg init` writes a working definition, not just a config. It asks where the
  definition should live and what it starts as: a starter, a blank, or the
  Tailwind or Material example. `--definition` and `--from` answer for it.
- An unnamed CSS output is named after its definition: `colors.dtg.yaml` gives
  `colors.generated.css`. It was `tokens.generated.css` for everything.
- `dtg dev` is now `dtg edit`, and the browser is the editor.
- The README is a quick start. The argument for the model moved to
  [Store colors as algorithms, not hexes](https://fifthrevision.com/writing/2026/Introducing-Design-Tokens-Generator.html).

### Algorithms

- `curve` (experimental): a ramp through a picked color, shaped by lightness,
  chroma and hue curves you edit in the editor.
- `tone` (experimental): the selector is lightness itself, CIELAB L\*, so
  contrast per tone holds across hues, as in Material 3.
- Color math runs in OKLab and in the widest space its inputs use, so a
  wide-gamut anchor is no longer clipped to sRGB on the way in. Some chromatic
  stops shift by one in a channel; plain CSS gains a `@supports (display-p3)`
  block for colors sRGB cannot show.

### Grammar

- `domain` is now `group`, in the definition and in the editor's URLs.
- Edits through a YAML alias are refused, and the editor shows what an anchor is
  shared with.

### Editor

- Resolution runs in the page. The dev server serves the working copy at
  `/api/state`; `state.json` replaces `snapshot.json` in `dtg docs`.
- `dtg docs --editable` lets visitors try edits in their own page.
- Embedded in an iframe, the editor posts its CSS as `dtg:css` on every change,
  and takes `dtg:background` from the host.
- The chrome is built on Mosaic's base stylesheet, with a narrow layout under
  640px. No bundled fonts; the system stack.
- Each mode has a scheme, declared as `scheme: light | dark` or read from its
  colors, and a background to view it on: white or black by scheme, or a color
  or ref set on the Settings page and kept in `editor.backgrounds`. The
  sidebar's background chip lists one entry per distinct background.
- One value editor everywhere, with Picker, Palette, Systems and Roles sources
  as the surface allows. A change shows live and commits as one undo step when
  the panel closes. Escape cancels.
- The overview page is gone. `/` is the definition, which now carries the
  warnings; the sidebar's top links are Definition and Settings.

### Package

- `exports` declares the API: `resolveDefinition`, `emitCss`, `emitScss`,
  `emitDtcg` and their types at the root, the CLI at `./cli`. Deep imports of
  `dist/` no longer resolve.
- The examples ship in the package, for `init --from`.
