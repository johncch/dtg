import * as Tooltip from "@radix-ui/react-tooltip";
import { version } from "../package.json";
import type { Snapshot, SnapshotSystem } from "../src/snapshot.js";
import { Backgrounds } from "./Backgrounds.js";
import { Changes } from "./Changes.js";
import { ProjectGamutProvider } from "./gamut.js";
import { TryingProvider } from "./preview.js";
import { ConstantsPage } from "./pages/ConstantsPage.js";
import { DefinitionPage, fileName } from "./pages/DefinitionPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { DomainPage, RolesPage } from "./pages/DomainPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { PalettePage, palettesOf } from "./pages/PalettePage.js";
import { SystemPage } from "./pages/SystemPage.js";
import { Link, useRoute, type Route } from "./router.js";
import { useSnapshot } from "./snapshot.js";
import { PaletteColorsProvider } from "./palette-colors.js";
import { UnsavedChangesProvider } from "./working.js";

export function App() {
  const state = useSnapshot();
  const route = useRoute();

  if (state.status === "loading") return <main />;
  if (state.status === "failed") {
    return (
      <main>
        <div className="banner">Could not load the definition: {state.message}</div>
      </main>
    );
  }
  const { snapshot } = state;
  return (
    <TryingProvider base={snapshot}>
      {(shown) => <Shell snapshot={shown} working={snapshot} route={route} />}
    </TryingProvider>
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
              <Backgrounds backgrounds={snapshot.backgrounds} />
              <Changes working={working} />
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
  const domains = [...new Set(snapshot.roles.map((role) => role.domain))];
  return (
    <>
      <h1>
        <Link to={{ page: "overview" }}>
          dtg <span className="version">{version}</span>
        </Link>
      </h1>
      <nav>
        <Link to={{ page: "definition" }}>{fileName(snapshot.definition.path)}</Link>
        <Link to={{ page: "settings" }}>settings</Link>
        {snapshot.constants.length > 0 && (
          <>
            <h2>Palette</h2>
            <Link to={{ page: "constants" }}>all</Link>
            {palettesOf(snapshot.constants).map(({ group }) => (
              <Link key={group} to={{ page: "palette", name: group }}>
                {group}
              </Link>
            ))}
          </>
        )}
        <h2>Systems</h2>
        <SystemLinks nodes={systemTree(snapshot.systems)} notes={snapshot.groupNotes.systems} />
        <h2>Roles</h2>
        {domains.length > 0 && <Link to={{ page: "roles" }}>all</Link>}
        <DomainLinks nodes={domainTree(domains)} />
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

/** Domains nest by their dotted names; a name that is a domain links to its page, one that only holds others is a label. */
type DomainNode = { name: string; domain: string | null; children: DomainNode[] };

function domainTree(domains: string[]): DomainNode[] {
  const roots: DomainNode[] = [];
  for (const domain of domains) {
    let level = roots;
    const names = domain.split(".");
    names.forEach((name, index) => {
      let node = level.find((candidate) => candidate.name === name);
      if (!node) level.push((node = { name, domain: null, children: [] }));
      if (index === names.length - 1) node.domain = domain;
      level = node.children;
    });
  }
  return roots;
}

function DomainLinks({ nodes }: { nodes: DomainNode[] }) {
  return nodes.map((node) => (
    <div key={node.name}>
      {node.domain ? (
        <Link to={{ page: "domain", name: node.domain }}>{node.name}</Link>
      ) : (
        <div className="nav-group-name">{node.name}</div>
      )}
      {node.children.length > 0 && (
        <div className="nav-group-items">
          <DomainLinks nodes={node.children} />
        </div>
      )}
    </div>
  ));
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
  if (route.page === "overview") return <OverviewPage snapshot={snapshot} />;
  if (route.page === "definition") return <DefinitionPage definition={snapshot.definition} />;
  if (route.page === "settings") return <SettingsPage configPath={snapshot.configPath} backgrounds={snapshot.backgrounds} />;
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
  if (route.page === "domain") {
    return snapshot.roles.some((role) => role.domain === route.name) ? (
      <DomainPage snapshot={snapshot} domain={route.name} />
    ) : (
      <NotFound what={`domain "${route.name}"`} />
    );
  }
  if (route.page === "system") {
    const system = snapshot.systems.find((candidate) => candidate.system === route.name);
    return system ? <SystemPage system={system} /> : <NotFound what={`system "${route.name}"`} />;
  }
  return <RolesPage snapshot={snapshot} />;
}
