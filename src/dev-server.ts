import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolveDefinition, type ResolvedDefinition } from "./resolve.js";
import { watchDefinition } from "./watch.js";
import {
  buildLineage,
  renderDomain,
  renderOverview,
  renderSystem,
  type Lineage,
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
      res.write("\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    const banner = state.error
      ? `<div class="banner">${state.error.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`
      : null;
    let html: string | null = null;
    if (url.pathname === "/") {
      html = renderOverview(state.resolved, banner);
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
