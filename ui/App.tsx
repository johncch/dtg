import * as Tooltip from "@radix-ui/react-tooltip";
import { Menu, X } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { version } from "../package.json";
import type { ResolvedDefinition } from "../src/resolve.js";
import type { Snapshot, SnapshotBackground, SnapshotSystem } from "../src/snapshot.js";
import { Appearance } from "./Appearance.js";
import { Changes } from "./Changes.js";
import { Export } from "./Export.js";
import { LiveCss } from "./LiveCss.js";
import { FollowWorkingCopy } from "./follow.js";
import { NewGroup } from "./RoleNaming.js";
import { NewSystem } from "./SystemEditor.js";
import { ProjectGamutProvider } from "./gamut.js";
import { TryingProvider } from "./preview.js";
import { ConstantsPage } from "./pages/ConstantsPage.js";
import { DefinitionPage } from "./pages/DefinitionPage.js";
import { ModesPage } from "./pages/ModesPage.js";
import { GroupPage, RolesPage } from "./pages/GroupPage.js";
import { NewCollection } from "./CollectionNaming.js";
import { NewPalette, PalettePage, palettesOf } from "./pages/PalettePage.js";
import { SystemPage } from "./pages/SystemPage.js";
import { Link, useRoute, type Route } from "./router.js";
import { useSnapshot } from "./snapshot.js";
import { StoreProvider } from "./store.js";
import { EDITABLE, SAVABLE } from "./mode.js";
import { PaletteColorsProvider } from "./palette-colors.js";
import { Alert } from "./Alert.js";

export function App() {
  const { state, store } = useSnapshot();
  const route = useRoute();

  if (state.status === "loading") return <main />;
  if (state.status === "failed") {
    return (
      <main>
        <Alert className="page-alert">Could not load the definition: {state.message}</Alert>
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
            <Shell snapshot={shown.snapshot} working={drawn.snapshot} resolved={drawn.resolved} route={route} />
          </>
        )}
      </TryingProvider>
    </StoreProvider>
  );
}

/** `snapshot` is what to draw, which may include a pick being tried; `working` is the working copy itself. */
function Shell({
  snapshot,
  working,
  resolved,
  route,
}: {
  snapshot: Snapshot;
  working: Snapshot;
  /** What `working` was resolved from. */
  resolved: ResolvedDefinition;
  route: Route;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [route]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(".popover")) setMenuOpen(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [menuOpen]);
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={400}>
      <ProjectGamutProvider value={snapshot.gamut}>
        <PaletteColorsProvider value={working.constants}>
          <aside data-menu={menuOpen ? "open" : "closed"}>
            <Brand backgrounds={snapshot.backgrounds} working={working} resolved={resolved} menuOpen={menuOpen} onMenu={() => setMenuOpen(!menuOpen)} />
            <div className="sidebar-body">
              <Nav snapshot={snapshot} working={working} />
            </div>
          </aside>
          <main>
            <div className="page">
              <Banner snapshot={snapshot} />
              <Page route={route} snapshot={snapshot} working={working} />
              <div className="dock">{EDITABLE && <Changes working={working} />}</div>
            </div>
          </main>
          <FollowWorkingCopy route={route} working={working} />
        </PaletteColorsProvider>
      </ProjectGamutProvider>
    </Tooltip.Provider>
  );
}

/** The title, and below the width a sidebar fits in, the button that opens the navigation as a menu. */
function Brand({
  backgrounds,
  working,
  resolved,
  menuOpen,
  onMenu,
}: {
  backgrounds: SnapshotBackground[];
  working: Snapshot;
  resolved: ResolvedDefinition;
  menuOpen: boolean;
  onMenu: () => void;
}) {
  return (
    <div className="brand">
      <h1>
        <Link to={{ page: "definition" }}>
          dtg <span className="version">{version}</span>
        </Link>
      </h1>
      <div className="brand-actions">
        <Export resolved={resolved} working={working} />
        <Appearance backgrounds={backgrounds} />
        <a className="nav-add" href="https://github.com/johncch/dtg" target="_blank" rel="noreferrer" aria-label="dtg on GitHub" title="dtg on GitHub">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
      <button type="button" className="menu-toggle" aria-label={menuOpen ? "Close menu" : "Menu"} aria-expanded={menuOpen} onClick={onMenu}>
        {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
      </button>
    </div>
  );
}

function Nav({ snapshot, working }: { snapshot: Snapshot; working: Snapshot }) {
  const sections = snapshot.sections;
  return (
    <>
      <nav>
        <div className="nav-section">
          <div className="nav-links">
            <Link to={{ page: "definition" }}>Definition</Link>
            {SAVABLE && <Link to={{ page: "modes" }}>Modes</Link>}
          </div>
        </div>
        {(snapshot.constants.length > 0 || EDITABLE) && (
          <div className="nav-section">
            <h2 className="nav-heading">
              Palette
              {EDITABLE && <NewPalette working={working} />}
            </h2>
            <div className="nav-links">
              <Link to={{ page: "constants" }}>All</Link>
              <GroupLinks
                notes={snapshot.groupNotes.palette}
                nodes={groupTree(palettesOf(snapshot.constants, snapshot.gradients).map(({ group }) => group))}
                pageOf={(name) => ({ page: "palette", name })}
              />
            </div>
          </div>
        )}
        <div className="nav-section">
          <h2 className="nav-heading">
            Systems
            {EDITABLE && <NewSystem working={working} />}
          </h2>
          <div className="nav-links">
            <SystemLinks nodes={systemTree(snapshot.systems)} notes={snapshot.groupNotes.systems} />
          </div>
        </div>
        {sections.map((section) => (
          <div key={section} className="nav-section">
            <h2 className="nav-heading">
              {section}
              {EDITABLE && <NewGroup working={working} section={section} />}
            </h2>
            <div className="nav-links">
              <Link to={{ page: "roles", section }}>All</Link>
              <GroupLinks
                notes={snapshot.groupNotes.roles}
                pageOf={(name) => ({ page: "group", name })}
                nodes={groupTree([
                  ...new Set(snapshot.roles.filter((role) => role.section === section && role.group !== "").map((role) => role.group)),
                ])}
              />
            </div>
          </div>
        ))}
        {EDITABLE && (
          <div className="nav-section nav-new-collection-section">
            <NewCollection working={working} />
          </div>
        )}
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

function SystemLinks({ nodes, notes, depth = 0 }: { nodes: SystemNode[]; notes: Record<string, string>; depth?: number }) {
  return nodes.map((node) =>
    node.system ? (
      <Link key={node.name} to={{ page: "system", name: node.system.system }} style={depthStyle(depth)}>
        {node.name} <span className="algorithm">{node.system.algorithm}</span>
      </Link>
    ) : (
      <NavGroup key={node.name} name={node.name} note={notes[node.path]} depth={depth}>
        <SystemLinks nodes={node.children} notes={notes} depth={depth + 1} />
      </NavGroup>
    ),
  );
}

function depthStyle(depth: number) {
  return { "--depth": depth } as CSSProperties;
}

function NavGroup({ name, note, depth, children }: { name: string; note: string | undefined; depth: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="nav-group">
      <button type="button" className="nav-group-toggle" style={depthStyle(depth)} title={note} aria-expanded={open} onClick={() => setOpen(!open)}>
        {name}
        <svg viewBox="0 0 8 8" width={8} height={8} aria-hidden><path d="M2.5 1.5 6.5 4 2.5 6.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="nav-group-items">
          {children}
        </div>
      )}
    </div>
  );
}

/** Groups nest by their dotted names; a name that holds entries links to its page, one that only holds groups is a label. */
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

function GroupLinks({
  nodes,
  notes,
  pageOf,
  prefix = "",
  depth = 0,
}: {
  nodes: GroupNode[];
  notes: Record<string, string>;
  /** The page a group with entries of its own links to. */
  pageOf: (group: string) => Exclude<Route, { page: "unknown" }>;
  prefix?: string;
  depth?: number;
}) {
  return nodes.map((node) => {
    const path = prefix + node.name;
    const children = <GroupLinks nodes={node.children} notes={notes} pageOf={pageOf} prefix={`${path}.`} depth={depth + 1} />;
    if (!node.group) {
      return (
        <NavGroup key={node.name} name={node.name} note={notes[path]} depth={depth}>
          {children}
        </NavGroup>
      );
    }
    return (
      <div key={node.name} className="nav-group">
        <Link to={pageOf(node.group)} title={notes[path]} style={depthStyle(depth)}>
          {node.name}
        </Link>
        {node.children.length > 0 && (
          <div className="nav-group-items">
            {children}
          </div>
        )}
      </div>
    );
  });
}

function Banner({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.stale) {
    return (
      <Alert variant="info" className="page-alert">
        dtg was rebuilt since this server started — restart it, or what you see below is from the old build.
      </Alert>
    );
  }
  if (snapshot.error) return <Alert className="page-alert">{snapshot.error}</Alert>;
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

function Page({ route, snapshot, working }: { route: Route; snapshot: Snapshot; working: Snapshot }) {
  if (route.page === "unknown") return <NotFound what={route.path} />;
  if (route.page === "definition") return <DefinitionPage definition={snapshot.definition} warnings={snapshot.warnings} />;
  if (route.page === "modes" && SAVABLE) return <ModesPage snapshot={snapshot} />;
  const named = [...snapshot.systems.map((system) => system.system), ...snapshot.roles.map((role) => role.group || role.role)].map((path) => path.split(".")[0]);
  if (route.page === "constants") {
    return snapshot.constants.length > 0 || EDITABLE ? (
      <ConstantsPage
        constants={snapshot.constants}
        gradients={snapshot.gradients}
        order={snapshot.paletteOrder}
        named={named}
        changes={snapshot.changes}
      />
    ) : (
      <NotFound what="constants — this definition declares none" />
    );
  }
  if (route.page === "palette") {
    const palette = palettesOf(snapshot.constants, snapshot.gradients).find((candidate) => candidate.group === route.name);
    return palette ? (
      <PalettePage
        key={palette.group}
        palette={palette}
        note={snapshot.groupNotes.palette[palette.group] ?? null}
        written={[...snapshot.constants.map((constant) => constant.path), ...snapshot.gradients.map((gradient) => gradient.path), ...snapshot.systems.map((system) => system.system)]}
        constants={snapshot.constants}
        gradients={snapshot.gradients}
        order={snapshot.paletteOrder}
        named={named}
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
    return system ? <SystemPage system={system} snapshot={snapshot} working={working} /> : <NotFound what={`system "${route.name}"`} />;
  }
  if (route.page === "roles" && route.section != null && !snapshot.sections.includes(route.section)) {
    return <NotFound what={`collection "${route.section}"`} />;
  }
  return <RolesPage key={route.page === "roles" ? (route.section ?? "") : ""} snapshot={snapshot} working={working} section={route.page === "roles" ? route.section : undefined} />;
}
