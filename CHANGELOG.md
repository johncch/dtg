# Changelog

## Unreleased

- Palette groups gain two circular views: a 2D hue/chroma disk and a
  fixed-camera 3D view adding lightness as height. Hue runs clockwise from
  the top. Switching views smoothly tilts the disk and raises or lowers
  the color dots, preserving selection; reduced-motion preferences skip
  the animation. Chroma increases outward, with neutrals at the center. Stems
  connect 3D points to their positions on the base disk. The disk uses a
  fixed reference lightness; points retain their actual colors. Dragging
  edits hue/chroma in 2D, preserving lightness; vertical dragging edits
  lightness in 3D, preserving hue/chroma. Swatches keep the original picker.
  Overlap badges let every color be selected. Double-click
  empty disk space (the base disk in 3D) to add at that hue/chroma, using
  the selection's lightness or the palette median. A locked color cannot
  be dragged, randomized or removed, and clicking it shows its
  values with an Unlock button where the picker would be. Edits use the
  usual undo and save.
  A sidebar on the right opens and closes with the
  settings button at the top right, and also closes with × or
  Escape. It holds the visualization, its view controls, Randomize's style and Harmonize in a
  scrolling area. Randomize sits beside the toggle.
  The + button beside the swatches is gone: hovering between two colors,
  or past the last, shows a + that adds a color at that place.
  Dragging a color's handle, or pressing Left or Right on it, moves the
  color within its group, in the definition too.
  A layout control beside the toggle shows the palette three ways, kept
  per browser. Strip fills the page down to the bottom of the window, with each
  color's controls, value
  and name drawn on the color; Grid is separate squares with the controls
  on the square and the value and name beneath; List is a
  table of path and value, as on the page of all colors. The value is the color as the definition writes it,
  with the name under it.
  A color is made the base with its Set base control, shown at the top
  left on hover in Strip and Grid, or by double-clicking its dot; setting
  one opens the sidebar.
  Randomize rolls any color, or with its Style set, any hue at the base
  color's lightness and chroma. Harmonize moves the unlocked colors' hues
  onto a scheme around the base (analogous, complementary, triad, evenly
  spaced), keeping each color's lightness and chroma. The base is the
  selected color, or the first locked one. Each is one undo step.

- The editor's panels (the color picker, rename, the ref editor) open beside
  the pointer where you clicked, not below the thing clicked. Opened from
  the keyboard, a panel still opens below its button.

- A role can hold a color directly: `surface: "#000000"` or
  `oklch(0 0 0)`. It emits as a value, not a reference, and the editor's
  role picker gains a Picker tab to choose one. dtg warns when the same color
  is written twice or matches a constant. Systems can no longer be named
  `oklch`, `oklab` or `color`.

## [0.4.0] - 2026-10-22

### Start here

- `dtg init` writes a working definition, not just a config. It asks where
  the definition should live and what it starts as: a starter, a blank, or
  the Tailwind or Material example. `--definition` and `--from` answer for
  it.
- An unnamed CSS output is named after its definition: `colors.dtg.yaml`
  gives `colors.generated.css`. It was `tokens.generated.css` for everything.
- `dtg dev` is now `dtg edit`, and the browser is the editor.
- The README is a quick start. The argument for the model moved to
  [Store colors as algorithms, not hexes](https://fifthrevision.com/writing/2026/Introducing-Design-Tokens-Generator.html).

### Algorithms

- `curve` (experimental): a ramp through a picked color, shaped by
  lightness, chroma and hue curves you edit in the editor.
- `tone` (experimental): the selector is lightness itself, CIELAB L\*, so
  contrast per tone holds across hues, as in Material 3.
- Color math runs in OKLab and in the widest space its inputs use, so a
  wide-gamut anchor is no longer clipped to sRGB on the way in. Some
  chromatic stops shift by one in a channel; plain CSS gains a
  `@supports (display-p3)` block for colors sRGB cannot show.

### Grammar

- `domain` is now `group`, in the definition and in the editor's URLs.
- Edits through a YAML alias are refused, and the editor shows what an
  anchor is shared with.

### Editor

- Resolution runs in the page. The dev server serves the working copy at
  `/api/state`; `state.json` replaces `snapshot.json` in `dtg docs`.
- `dtg docs --editable` lets visitors try edits in their own page.
- Embedded in an iframe, the editor posts its CSS as `dtg:css` on every
  change, and takes `dtg:background` from the host.
- The chrome is built on Mosaic's base stylesheet, with a narrow layout
  under 640px. No bundled fonts; the system stack.
- Each mode has a scheme, declared as `scheme: light | dark` or read from
  its colors, and a background to view it on: white or black by scheme, or
  a color or ref set on the Settings page and kept in
  `editor.backgrounds`. The sidebar's background chip lists one entry per
  distinct background.
- One value editor everywhere, with Picker, Palette, Systems and Roles
  sources as the surface allows. A change shows live and commits as one
  undo step when the panel closes. Escape cancels.
- The overview page is gone. `/` is the definition, which now carries the
  warnings; the sidebar's top links are Definition and Settings.

### Package

- `exports` declares the API: `resolveDefinition`, `emitCss`, `emitScss`,
  `emitDtcg` and their types at the root, the CLI at `./cli`. Deep imports
  of `dist/` no longer resolve.
- The examples ship in the package, for `init --from`.
