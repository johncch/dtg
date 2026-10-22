# dtg — agent notes

**Read `docs/how-this-works.md` before changing anything.** It is the design
doc: the grammar, the algorithms, and — most importantly — the decisions
that were settled in long-form conversation with Chong Han and should not be
re-litigated (no middle scale tier, no role flags, no literals in the
semantic tier, demand-driven primitives, deterministic generation, explicit
over inferred). `README.md` is the user-facing summary of the same system.

Working notes:

- Source is ESM TypeScript in `src/` with explicit `.js` extensions on
  relative imports (NodeNext). `pnpm build` → `dist/`; the `dtg` bin is
  `dist/cli.js`.
- Sunnyday (`~/Projects/sunnyday/sunnyday-app`) consumes this package as
  `link:../../dtg` until it's published — **consumers run `dist/`, so
  rebuild after edits or they see stale code**.
- `pnpm dev --definition <file>` runs `tsc --watch`, `vite build --watch`, and
  the dev server under `node --watch`: edits to `src/` rebuild, restart the
  server, and reload the browser; edits to `ui/` rebuild the bundle and reload.
  Extra flags pass through to `dtg dev`. `pnpm watch` is the two watchers
  without the server, for running `dist/cli.js` from another project.
- `ui/mosaic/` is a copy of Mosaic's `dist/base.css` (tokens and element
  defaults). Refresh it by running
  `pnpm build:base` in `~/Projects/mosaic` and copying; never edit it in
  place. `ui/app.css` maps its own names onto Mosaic's at the top.
- The browsing UI is a React app in `ui/`, bundled by Vite into `dist/ui/`.
  The dev server serves one HTML shell for every page address plus
  `/api/state` (`src/dev-state.ts`): the working copy and settings, not
  resolved. The app resolves it in the page (`ui/engine.ts`, which imports
  the resolver and `src/snapshot.ts`), routes, and draws. It has its
  own `ui/tsconfig.json`; `pnpm build` type-checks it. React and Vite are
  devDependencies — the bundle is what ships.
- Conventions the tool promises (see README): a `dtg.config.yaml` project config at
  root names the definition (`dtg init` writes a starter definition and the
  config, asking where the definition goes); there is no default place dtg
  looks for one. An unnamed CSS output lands beside the definition, named
  after it (`colors.dtg.yaml` → `colors.generated.css`). Flags >
  `dtg.config.yaml` > defaults.
- `pnpm test` builds, then runs `node --test` over `test/*.test.ts`. Tests
  import from `dist/`, not `src/` — Node's type stripping does not remap a
  `.js` specifier onto a `.ts` file — so the script builds first and a stale
  artifact cannot give a false pass. Beyond that, verification is the dev
  server and (for Sunnyday) parity of emitted CSS against what shipped.
- Extend by conversation with Chong Han first, in small steps. If a feature
  can't be expressed as "edit one line of definition, regenerate," question
  the feature.
