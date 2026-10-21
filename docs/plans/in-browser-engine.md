# Plan: the engine in the browser

Move resolving from the dev server into the page. The server keeps what only
a server can do (read, write and watch files) and the page does everything
else. Two things follow that are hard today: a published `dtg docs` site
that can be edited but not saved, and a host page (Mosaic's studio) that
re-skins live as you edit.

## Why it is possible

Everything between the YAML text and what the app draws is already plain
code: `resolve`, `snapshot`, `edit`, `working-copy`, `params`, `selector`,
`color-math`, `curve-math`, the algorithms and `emit`. None imports Node;
the only dependency is `yaml`. The page already imports `color-math`
directly. Only `dev-server`, `site`, `outputs`, `config` and `watch` touch
the filesystem.

## What changes hands

| Today, on the server | After |
|---|---|
| `/api/preview`: apply an edit, resolve, send a snapshot | the page, no request |
| `/api/probe`: resolve one ref | the page, no request |
| `/api/snapshot`: resolve the working copy | the page, from the working copy |
| `/api/edits`: refuse a step that doesn't resolve | the page checks before sending; the server only records it |
| holding the working copy, undo, redo, discard | unchanged: the server still holds it, so tabs agree and unsaved edits survive the file changing |
| save, backgrounds, watching, `--build` outputs | unchanged |

The server still resolves for `dtg build`, `--build` and `dtg docs`; it just
no longer resolves to draw the app.

The working copy is the sync format: the file's text plus the steps and the
undone steps. It is small and plain JSON. The bridge hands it over whole on
`GET /api/state` (with the settings the page needs: config path,
backgrounds, gamut, stale) and says "changed" over the existing event
stream.

## One interface, two stores

The page talks to a store, never to `fetch` directly:

```ts
type Store = {
  state: StoreState;              // the working copy and settings, as last known
  commit(edits: Edit[]): void;    // a new step
  undo(): void;
  redo(): void;
  discard(): void;
  save: (() => void) | null;      // null where there is nowhere to save to
  setBackgrounds: ((b: Background[]) => void) | null;
};
```

- **Bridge store** (`dtg dev`): each command is a POST; the new state comes
  back over the event stream.
- **Memory store** (`dtg docs`): the same commands applied to a working copy
  held in the page, with `working-copy.ts`'s own functions. `save` and
  `setBackgrounds` are null, so the app hides them. Reloading starts over
  from the published file.

The five files that call `fetch` today (`snapshot.ts`, `preview.tsx`,
`Probe.tsx`, `Changes.tsx`, `SettingsPage.tsx`) call the store instead.
Resolving, previewing and probing become one function of the working copy,
shared by both stores.

What `STATIC` gates today splits in two: *can it edit* (both stores) and
*can it save* (bridge only). Addressing pages by fragment stays tied to
static files.

## `dtg docs`

Writes the definition text and the settings instead of a resolved
`snapshot.json`; the page resolves on load. Editing is behind
`--editable`: without it a published site stays read-only, as today, so a
demo is an explicit choice. With it, edits work, nothing persists, and the
Changes bar says so in place of Save.

## Live CSS for a host page

When the page is inside an iframe, every time what it draws changes,
including mid-drag previews, it emits the CSS (`emitCss`, with the format
and mode rendering from `dtg.config.yaml`, baked in by `dtg docs`) and
posts it to the parent:

```ts
parent.postMessage({ type: "dtg:css", css }, "*");
```

The host puts it in a `<style>` after its own stylesheet. Same selectors,
later in the document, so it wins. For Mosaic, whose components read
Tailwind v4 variables at runtime, that is the whole integration: about ten
lines in the studio, no server, deployable to GitHub Pages as now.

The message carries only generated CSS, which is public anyway, so `"*"`
leaks nothing. A host should check `event.source` is its own iframe.

## Costs

- The bundle grows by `yaml` and the resolver: roughly 100–150 KB on today's
  360 KB.
- Resolving on every drag frame moves from the server's thread to the
  page's. It is the same work minus a round trip; measure on Mosaic's
  definition, and move it to a worker only if a drag stutters.
- A resolve error keeps the last good picture and shows the error, as the
  server does now; that logic moves with `settle`.

## Batches

1. **Preview and probe in the page.** Resolve locally for previews and
   probes, from the working text the snapshot already carries;
   `/api/preview` and `/api/probe` go away. The server keeps everything
   else. Visible result: drags stop waiting on the network. Smallest step
   that proves the engine runs in the browser.
2. **The bridge.** `/api/state` returns the working copy; the page draws
   from it, and `/api/snapshot` goes away. The store
   interface lands here, with the bridge store only.
3. **Editable docs.** The memory store, the docs output change, the
   can-edit / can-save split, the Changes bar's "not saved" state.
4. **Live CSS.** The parent message, and the config baked into docs.
5. **Mosaic.** The listener, and putting the editor beside the components.
   Mosaic's call, separately.
