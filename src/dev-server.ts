import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Gamut } from "./color-math.js";
import type { DtgConfig } from "./config.js";
import type { ModeRendering } from "./emit.js";
import {
  DEFAULT_BACKGROUNDS,
  readBackgrounds,
  withBackgrounds,
  type Background,
} from "./dev-settings.js";
import { writeOutputs } from "./outputs.js";
import { describeTarget, type Edit } from "./edit.js";
import { resolveDefinition } from "./resolve.js";
import { appShell } from "./app-shell.js";
import type { DevState } from "./dev-state.js";
import { watchDefinition } from "./watch.js";
import {
  discard,
  openFile,
  redo,
  undo,
  withEdits,
  withoutEdits,
  workingText,
  type WorkingCopy,
} from "./working-copy.js";

const CONFIG_PATH = "dtg.config.yaml";

const UI_CONTENT_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  png: "image/png",
};

type State = {
  copy: WorkingCopy;
  /** Unsaved changes that could not be carried over when the file changed. */
  notices: string[];
};

export function startDevServer(
  definitionPath: string,
  port: number,
  gamut: Gamut,
  cssModes: ModeRendering,
  /** Where to write the outputs whenever the definition file changes, or null to leave them alone. */
  outputs: DtgConfig | null,
): void {
  const readDisk = () => readFileSync(definitionPath, "utf8");

  // The outputs follow the file on disk, never the unsaved edits on top of
  // it: what is generated stays a function of the definition alone.
  let emitted: string | null = null;
  const emitFromDisk = () => {
    if (!outputs) return;
    const text = readDisk();
    if (text === emitted) return;
    try {
      writeOutputs(outputs, resolveDefinition(text, [], gamut));
      emitted = text;
    } catch (e) {
      console.error(`not emitted: ${(e as Error).message}`);
    }
  };
  emitFromDisk();

  // Backgrounds are settings, not the definition: they are read from and
  // written to `dtg.config.yaml` directly, outside the working copy and its undo.
  const readConfig = () => (existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf8") : "");
  let backgrounds: Background[] = [];
  const takeBackgroundsFromConfig = () => {
    try {
      backgrounds = readBackgrounds(readConfig());
    } catch (e) {
      console.error(`${CONFIG_PATH} ${(e as Error).message} — keeping the backgrounds as they were`);
    }
  };
  takeBackgroundsFromConfig();

  // A definition that does not resolve at startup stops the server here; once
  // it is running, the page resolves and shows any error itself.
  try {
    resolveDefinition(readDisk(), [], gamut);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  let state: State = settle(openFile(readDisk()));
  const sseClients = new Set<ServerResponse>();
  const tellBrowsers = (message: "changed" | "reload") => {
    for (const client of sseClients) client.write(`data: ${message}\n\n`);
  };
  const stateOf = (current: State): DevState => ({
    copy: current.copy,
    notices: current.notices,
    stale,
    gamut,
    definitionPath: resolve(definitionPath),
    configPath: resolve(CONFIG_PATH),
    backgrounds: backgrounds.length > 0 ? backgrounds : DEFAULT_BACKGROUNDS,
    cssModes,
  });
  const adopt = (copy: WorkingCopy) => {
    state = settle(copy);
    tellBrowsers("changed");
  };

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
      tellBrowsers("changed");
    });
  } catch {
    // watching the install directory is a convenience, never a requirement
  }

  let uiChanged: NodeJS.Timeout | undefined;
  try {
    watch(join(own, "ui"), () => {
      // A rebuild empties the directory before writing; reload once it settles.
      clearTimeout(uiChanged);
      uiChanged = setTimeout(() => tellBrowsers("reload"), 150);
    });
  } catch {
    // no browser bundle built yet; pages still render without it
  }

  watchDefinition(CONFIG_PATH, () => {
    takeBackgroundsFromConfig();
    tellBrowsers("changed");
  });

  watchDefinition(definitionPath, () => {
    // Unsaved edits ride along: they name colors, not lines, so they are
    // applied again to whatever the file says now.
    adopt({ ...state.copy, diskText: readDisk() });
    emitFromDisk();
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

    const uiAsset = /^\/ui\/([\w.-]+\.(js|css|png))$/.exec(url.pathname);
    if (uiAsset) {
      try {
        const body = readFileSync(new URL(`./ui/${uiAsset[1]}`, import.meta.url));
        res.writeHead(200, {
          "content-type": UI_CONTENT_TYPES[uiAsset[2]],
          "cache-control": "no-cache",
        });
        res.end(body);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      }
      return;
    }

    const sendJson = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-cache",
      });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/api/state") {
      sendJson(200, stateOf(state));
      return;
    }

    if (url.pathname === "/api/edits" && req.method === "POST") {
      readJson(req).then((body) => {
        const { edits } = body as { edits: Edit[] };
        const next = settle(withEdits(state.copy, edits));
        // A step any of whose edits cannot be applied is refused whole rather
        // than kept as a change nobody can see. Whether the result resolves
        // the page checked before sending.
        const kept = next.copy.steps.at(-1) ?? [];
        const intact = kept.length === edits.length && edits.every((edit) => kept.includes(edit));
        if (!intact) {
          sendJson(422, { error: "that value is not in the definition" });
          return;
        }
        state = next;
        tellBrowsers("changed");
        sendJson(200, {});
      });
      return;
    }

    const step = { "/api/undo": undo, "/api/redo": redo, "/api/discard": discard }[url.pathname];
    if (step && req.method === "POST") {
      adopt(step(state.copy));
      sendJson(200, {});
      return;
    }

    if (url.pathname === "/api/save" && req.method === "POST") {
      try {
        // Read again rather than trust what was last seen: the write is the
        // file as it is this instant, plus the edits.
        const { text } = workingText({ ...state.copy, diskText: readDisk() });
        writeFileSync(definitionPath, text);
        // Saving wipes the board: no unsaved edits, and no history to undo into.
        adopt(openFile(text));
        sendJson(200, {});
      } catch (e) {
        sendJson(500, { error: (e as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/backgrounds" && req.method === "POST") {
      readJson(req).then((body) => {
        try {
          const wanted = (body as { backgrounds: Background[] }).backgrounds;
          writeFileSync(CONFIG_PATH, withBackgrounds(readConfig(), wanted));
          backgrounds = wanted;
          tellBrowsers("changed");
          sendJson(200, {});
        } catch (e) {
          sendJson(422, { error: (e as Error).message });
        }
      });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(appShell(`dtg · ${resolve(definitionPath)}`, "served"));
  });

  server.listen(port, () => {
    console.log(`colors dev server → http://localhost:${port}`);
    console.log(`watching ${definitionPath}`);
  });
}

/**
 * A working copy without the edits the file can no longer take, each
 * reported. The page resolves what is left.
 */
function settle(copy: WorkingCopy): State {
  const { dropped } = workingText(copy);
  return {
    copy: withoutEdits(copy, dropped),
    notices: dropped.map(
      (e) => `an unsaved change to ${describeTarget(e.target)} was dropped — the file no longer has that value`,
    ),
  };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}
