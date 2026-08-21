import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, watch } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { formatColor, isOpaque } from "./color-math.js";
import { withParamAt } from "./contract.js";
import {
  algorithmFor,
  buildLineage,
  resolveDefinition,
  type Lineage,
  type ResolvedDefinition,
} from "./resolve.js";
import { watchDefinition } from "./watch.js";
import {
  renderBlend,
  renderConstants,
  renderDomain,
  renderOverview,
  renderPicker,
  renderSystem,
} from "./render.js";

type State = {
  resolved: ResolvedDefinition;
  lineage: Lineage;
  /** Set when the last re-resolve failed; the previous good state stays served. */
  error: string | null;
};

export function startDevServer(definitionPath: string, port: number): void {
  let state: State = load(definitionPath);
  const sseClients = new Set<ServerResponse>();

  // The server holds dtg's own code from startup, so a rebuild leaves it
  // serving stale results that look like definition errors. Say so instead —
  // but compare content, since `tsc` rewrites every file on every build and
  // a banner that cries wolf is one you learn to ignore.
  let stale = false;
  const own = dirname(fileURLToPath(import.meta.url));
  const fingerprint = () => {
    const hash = createHash("sha1");
    for (const name of readdirSync(own).sort()) {
      if (name.endsWith(".js")) hash.update(readFileSync(join(own, name)));
    }
    return hash.digest("hex");
  };
  try {
    const built = fingerprint();
    watch(own, () => {
      if (stale || fingerprint() === built) return;
      stale = true;
      console.log("dtg's own code changed — restart the dev server");
      for (const client of sseClients) client.write("data: reload\n\n");
    });
  } catch {
    // watching the install directory is a convenience, never a requirement
  }

  watchDefinition(definitionPath, () => {
    state = load(definitionPath, state);
    for (const client of sseClients) client.write("data: reload\n\n");
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      sseClients.add(res);
      // A heartbeat so a stream orphaned by a closed tab errors and is
      // reaped, rather than sitting in the set forever.
      const beat = setInterval(() => res.write(": ping\n\n"), 15_000);
      beat.unref?.();
      const drop = () => {
        clearInterval(beat);
        sseClients.delete(res);
      };
      req.on("close", drop);
      res.on("close", drop);
      res.on("error", drop);
      return;
    }

    if (url.pathname === "/color-math.js") {
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(readFileSync(new URL("./color-math.js", import.meta.url), "utf8"));
      return;
    }

    if (url.pathname === "/preview" && req.method === "POST") {
      readBody(req).then((body) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(preview(state.resolved, body)));
      });
      return;
    }

    const staleBanner = stale
      ? `<div class="banner">dtg was rebuilt since this server started — restart it, or what you see below is from the old build.</div>`
      : "";
    const banner =
      staleBanner ||
      (state.error
        ? `<div class="banner">${state.error.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`
        : null);
    let html: string | null = null;
    if (url.pathname === "/") {
      html = renderOverview(state.resolved, banner);
    } else if (url.pathname === "/constants") {
      html = renderConstants(state.resolved, state.lineage, banner);
    } else if (url.pathname === "/colors") {
      html = renderPicker(state.resolved, banner);
    } else if (url.pathname === "/blend") {
      html = renderBlend(state.resolved, banner);
    } else {
      const [, kind, name] = url.pathname.split("/");
      if (kind === "system" && name)
        html = renderSystem(state.resolved, name, state.lineage, banner);
      if (kind === "domain" && name)
        html = renderDomain(state.resolved, name, banner);
    }
    if (html == null) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });

  server.listen(port, () => {
    console.log(`colors dev server → http://localhost:${port}`);
    console.log(`watching ${definitionPath}`);
  });
}

function load(definitionPath: string, previous?: State): State {
  try {
    const resolved = resolveDefinition(readFileSync(definitionPath, "utf8"));
    return { resolved, lineage: buildLineage(resolved), error: null };
  } catch (e) {
    const message = (e as Error).message;
    if (previous) return { ...previous, error: message };
    console.error(message);
    process.exit(1);
  }
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Re-run one system's algorithm with tweaked params. The math stays on the
 * server so the browser never carries a second implementation of it.
 */
function preview(
  resolved: ResolvedDefinition,
  body: Record<string, unknown>,
): unknown {
  const system = resolved.systems.find((s) => s.system === body.system);
  const algo = system && algorithmFor(system.algorithm);
  if (!system || !algo) return { error: `unknown system "${body.system}"` };

  let params = system.params;
  for (const [path, value] of Object.entries(
    (body.overrides ?? {}) as Record<string, unknown>,
  )) {
    params = withParamAt(params, path, value);
  }

  try {
    algo.declaredSelectors(params);
    const selectors = new Set(system.steps.map((s) => s.selector));
    for (const s of (body.selectors ?? []) as string[]) selectors.add(s);
    const steps = [...selectors].map((selector) => {
      const value = algo.resolveStep(params, selector);
      return {
          selector,
          css: formatColor(value.color, "srgb"),
          opaque: isOpaque(value.color),
        };
    });
    return { steps, yaml: stringify(params).trimEnd() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
