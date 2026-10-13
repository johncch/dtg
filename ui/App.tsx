import * as Tooltip from "@radix-ui/react-tooltip";
import { version } from "../package.json";
import type { Snapshot } from "../src/snapshot.js";
import { Backgrounds } from "./Backgrounds.js";
import { Changes } from "./Changes.js";
import { ProjectGamutProvider } from "./gamut.js";
import { TryingProvider } from "./preview.js";
import { ConstantsPage } from "./pages/ConstantsPage.js";
import { DefinitionPage, fileName } from "./pages/DefinitionPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { DomainPage, RolesPage } from "./pages/DomainPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { SystemPage } from "./pages/SystemPage.js";
import { Link, useRoute, type Route } from "./router.js";
import { useSnapshot } from "./snapshot.js";
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
        <h2>Systems</h2>
        {snapshot.systems.map((system) => (
          <Link key={system.system} to={{ page: "system", name: system.system }}>
            {system.system} <span className="algorithm">{system.algorithm}</span>
          </Link>
        ))}
        {snapshot.constants.length > 0 && <Link to={{ page: "constants" }}>constants</Link>}
        <h2>Roles</h2>
        {domains.length > 0 && <Link to={{ page: "roles" }}>all</Link>}
        {domains.map((domain) => (
          <Link key={domain} to={{ page: "domain", name: domain }}>
            {domain}
          </Link>
        ))}
      </nav>
    </>
  );
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
