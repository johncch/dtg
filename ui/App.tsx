import { Fragment } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { version } from "../package.json";
import type { Snapshot, SnapshotSystem } from "../src/snapshot.js";
import { Backgrounds } from "./Backgrounds.js";
import { Changes } from "./Changes.js";
import { LiveCss } from "./LiveCss.js";
import { ProjectGamutProvider } from "./gamut.js";
import { TryingProvider } from "./preview.js";
import { ConstantsPage } from "./pages/ConstantsPage.js";
import { DefinitionPage } from "./pages/DefinitionPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { GroupPage, RolesPage } from "./pages/GroupPage.js";
import { PalettePage, palettesOf } from "./pages/PalettePage.js";
import { SystemPage } from "./pages/SystemPage.js";
import { Link, useRoute, type Route } from "./router.js";
import { useSnapshot } from "./snapshot.js";
import { StoreProvider } from "./store.js";
import { EDITABLE, SAVABLE } from "./mode.js";
import { PaletteColorsProvider } from "./palette-colors.js";
import { UnsavedChangesProvider } from "./working.js";

export function App() {
  const { state, store } = useSnapshot();
  const route = useRoute();

  if (state.status === "loading") return <main />;
  if (state.status === "failed") {
    return (
      <main>
        <div className="banner">Could not load the definition: {state.message}</div>
      </main>
    );
  }
  const { drawn, cssModes } = state;
  return (
    <StoreProvider value={store}>
      <TryingProvider base={drawn}>
        {(shown) => (
          <>
            <LiveCss resolved={shown.resolved} modes={cssModes} />
            <Shell snapshot={shown.snapshot} working={drawn.snapshot} route={route} />
          </>
        )}
      </TryingProvider>
    </StoreProvider>
  );
}

/** `snapshot` is what to draw, which may include a pick being tried; `working` is the working copy itself. */
function Shell({ snapshot, working, route }: { snapshot: Snapshot; working: Snapshot; route: Route }) {
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={400}>
      <ProjectGamutProvider value={snapshot.gamut}>
        <UnsavedChangesProvider value={working.changes}>
          <PaletteColorsProvider value={working.constants}>
            <aside>
              <Nav snapshot={snapshot} />
              <div className="dock">
                {EDITABLE && <Changes working={working} />}
                <Backgrounds backgrounds={snapshot.backgrounds} />
              </div>
            </aside>
            <main>
              <div className="page">
                <Banner snapshot={snapshot} />
                <Page route={route} snapshot={snapshot} />
              </div>
            </main>
          </PaletteColorsProvider>
        </UnsavedChangesProvider>
      </ProjectGamutProvider>
    </Tooltip.Provider>
  );
}

function Nav({ snapshot }: { snapshot: Snapshot }) {
  const sections = [...new Set(snapshot.roles.map((role) => role.section))];
  return (
    <>
      <div className="brand">
        <h1>
          <Link to={{ page: "definition" }}>
            dtg <span className="version">{version}</span>
          </Link>
        </h1>
        <a className="brand-github" href="https://github.com/johncch/dtg" target="_blank" rel="noreferrer" aria-label="dtg on GitHub" title="dtg on GitHub">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
      <nav>
        <Link to={{ page: "definition" }}>Definition</Link>
        {SAVABLE && <Link to={{ page: "settings" }}>Settings</Link>}
        {snapshot.constants.length > 0 && (
          <>
            <h2>Palette</h2>
            <Link to={{ page: "constants" }}>All</Link>
            {palettesOf(snapshot.constants).map(({ group }) => (
              <Link key={group} to={{ page: "palette", name: group }}>
                {group}
              </Link>
            ))}
          </>
        )}
        <h2>Systems</h2>
        <SystemLinks nodes={systemTree(snapshot.systems)} notes={snapshot.groupNotes.systems} />
        {sections.map((section) => (
          <Fragment key={section}>
            <h2>{section}</h2>
            <Link to={{ page: "roles", section }}>All</Link>
            <GroupLinks
              notes={snapshot.groupNotes.roles}
              nodes={groupTree([
                ...new Set(snapshot.roles.filter((role) => role.section === section && role.group !== "").map((role) => role.group)),
              ])}
            />
          </Fragment>
        ))}
      </nav>
    </>
  );
}

/** A systems group in the sidebar holds its systems and groups by their own names; a system is a link to its page. */
type SystemNode = { name: string; path: string; system: SnapshotSystem | null; children: SystemNode[] };

function systemTree(systems: SnapshotSystem[]): SystemNode[] {
  const roots: SystemNode[] = [];
  for (const system of systems) {
    let level = roots;
    const names = system.system.split(".");
    names.forEach((name, index) => {
      let node = level.find((candidate) => candidate.name === name);
      if (!node) level.push((node = { name, path: names.slice(0, index + 1).join("."), system: null, children: [] }));
      if (index === names.length - 1) node.system = system;
      level = node.children;
    });
  }
  return roots;
}

function SystemLinks({ nodes, notes }: { nodes: SystemNode[]; notes: Record<string, string> }) {
  return nodes.map((node) =>
    node.system ? (
      <Link key={node.name} to={{ page: "system", name: node.system.system }}>
        {node.name} <span className="algorithm">{node.system.algorithm}</span>
      </Link>
    ) : (
      <div key={node.name} className="nav-group">
        <div className="nav-group-name" title={notes[node.path]}>
          {node.name}
        </div>
        <div className="nav-group-items">
          <SystemLinks nodes={node.children} notes={notes} />
        </div>
      </div>
    ),
  );
}

/** Role groups nest by their dotted names; a name that holds roles links to its page, one that only holds groups is a label. */
type GroupNode = { name: string; group: string | null; children: GroupNode[] };

function groupTree(groups: string[]): GroupNode[] {
  const roots: GroupNode[] = [];
  for (const group of groups) {
    let level = roots;
    const names = group.split(".");
    names.forEach((name, index) => {
      let node = level.find((candidate) => candidate.name === name);
      if (!node) level.push((node = { name, group: null, children: [] }));
      if (index === names.length - 1) node.group = group;
      level = node.children;
    });
  }
  return roots;
}

function GroupLinks({ nodes, notes, prefix = "" }: { nodes: GroupNode[]; notes: Record<string, string>; prefix?: string }) {
  return nodes.map((node) => {
    const path = prefix + node.name;
    return (
      <div key={node.name} className="nav-group">
        {node.group ? (
          <Link to={{ page: "group", name: node.group }} title={notes[path]}>
            {node.name}
          </Link>
        ) : (
          <div className="nav-group-name" title={notes[path]}>
            {node.name}
          </div>
        )}
        {node.children.length > 0 && (
          <div className="nav-group-items">
            <GroupLinks nodes={node.children} notes={notes} prefix={`${path}.`} />
          </div>
        )}
      </div>
    );
  });
}

function Banner({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.stale) {
    return (
      <div className="banner">
        dtg was rebuilt since this server started — restart it, or what you see below is from the old build.
      </div>
    );
  }
  if (snapshot.error) return <div className="banner">{snapshot.error}</div>;
  return null;
}

function NotFound({ what }: { what: string }) {
  return (
    <>
      <h1>Not found</h1>
      <p className="sub">Nothing lives at {what}.</p>
    </>
  );
}

function Page({ route, snapshot }: { route: Route; snapshot: Snapshot }) {
  if (route.page === "unknown") return <NotFound what={route.path} />;
  if (route.page === "definition") return <DefinitionPage definition={snapshot.definition} warnings={snapshot.warnings} />;
  if (route.page === "settings" && SAVABLE) return <SettingsPage configPath={snapshot.configPath} snapshot={snapshot} />;
  if (route.page === "constants") {
    return snapshot.constants.length > 0 ? (
      <ConstantsPage constants={snapshot.constants} />
    ) : (
      <NotFound what="constants — this definition declares none" />
    );
  }
  if (route.page === "palette") {
    const palette = palettesOf(snapshot.constants).find((candidate) => candidate.group === route.name);
    return palette ? (
      <PalettePage
        key={palette.group}
        palette={palette}
        note={snapshot.groupNotes.palette[palette.group] ?? null}
        written={[...snapshot.constants.map((constant) => constant.path), ...snapshot.systems.map((system) => system.system)]}
        changes={snapshot.changes}
      />
    ) : (
      <NotFound what={`palette "${route.name}" — no group of constants has that path`} />
    );
  }
  if (route.page === "group") {
    return snapshot.roles.some((role) => role.group === route.name) ? (
      <GroupPage snapshot={snapshot} group={route.name} />
    ) : (
      <NotFound what={`group of roles "${route.name}"`} />
    );
  }
  if (route.page === "system") {
    const system = snapshot.systems.find((candidate) => candidate.system === route.name);
    return system ? <SystemPage system={system} snapshot={snapshot} /> : <NotFound what={`system "${route.name}"`} />;
  }
  if (route.page === "roles" && route.section != null && !snapshot.roles.some((role) => role.section === route.section)) {
    return <NotFound what={`section "${route.section}"`} />;
  }
  return <RolesPage key={route.page === "roles" ? (route.section ?? "") : ""} snapshot={snapshot} section={route.page === "roles" ? route.section : undefined} />;
}
