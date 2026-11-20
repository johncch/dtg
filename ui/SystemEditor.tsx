import { Plus, SlidersHorizontal } from "lucide-react";
import { useLayoutEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import type { Algorithm, ParamKind } from "../src/contract.js";
import type { Edit, SystemTarget } from "../src/edit.js";
import { builtinAlgorithms } from "../src/resolve.js";
import type { Snapshot, SnapshotSystem } from "../src/snapshot.js";
import { previewOf } from "./engine.js";
import { Popup, type PopupPanel } from "./Popup.js";
import { useTrying } from "./preview.js";
import { navigate } from "./router.js";

const DEFAULT_START = "#808080";

/** A starting value for a param that has to be written: every color is `start`. Null for a kind with nothing to start from. */
function startOf(kind: ParamKind, start: string): unknown {
  if (kind.kind === "color") return start;
  if (kind.kind === "list" && kind.length != null) {
    const item = startOf(kind.of, start);
    return item == null ? null : Array<unknown>(kind.length).fill(item);
  }
  return null;
}

function isRequired(kind: ParamKind): boolean {
  if ("default" in kind && kind.default !== undefined) return false;
  return !(kind.kind === "number" && kind.optional);
}

/** Whether a value written for one param can be read as the other: the same kind, down through lists and maps. */
function sameKind(a: ParamKind, b: ParamKind): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "list" && b.kind === "list") return a.length === b.length && sameKind(a.of, b.of);
  if (a.kind === "map" && b.kind === "map") return sameKind(a.of, b.of);
  if (a.kind === "curve" && b.kind === "curve") return a.along === b.along;
  return true;
}

type Recipe = {
  params: Record<string, unknown>;
  /** The params this recipe starts on the palette's first color. */
  started: string[];
  /** The params of `from` that carry over, and the ones the algorithm has no place for. */
  kept: string[];
  dropped: string[];
};

/**
 * What a system of `algorithm` is written with: the params `from` wrote that
 * the algorithm also takes, then each one it cannot go without, and
 * `defaults` does not share, started on the palette's first color.
 */
function recipeOf(working: Snapshot, algorithm: Algorithm, from: SnapshotSystem | null): Recipe {
  const shared = (parse(working.definition.text) as { defaults?: Record<string, Record<string, unknown>> }).defaults?.[algorithm.name] ?? {};
  const start = working.constants[0]?.path ?? DEFAULT_START;
  const before = from ? (builtinAlgorithms.find((candidate) => candidate.name === from.algorithm)?.params ?? {}) : {};
  const written = from?.ownParams ?? [];
  const kept = written.filter((key) => key in algorithm.params && key in before && sameKind(before[key], algorithm.params[key]));
  const params: Record<string, unknown> = Object.fromEntries(kept.map((key) => [key, from!.params[key]]));
  const started: string[] = [];
  for (const [key, kind] of Object.entries(algorithm.params)) {
    if (key in params || key in shared || !isRequired(kind)) continue;
    const value = startOf(kind, start);
    if (value == null) continue;
    params[key] = value;
    started.push(key);
  }
  return { params, started, kept, dropped: written.filter((key) => !kept.includes(key)) };
}

let awaited: string | null = null;

/**
 * Opens the page of a system an edit just named, once the working copy has
 * it. Before paint, so a renamed system's old address never shows as missing.
 */
export function OpenAwaitedSystem({ working }: { working: Snapshot }) {
  useLayoutEffect(() => {
    if (awaited == null || !working.systems.some((system) => system.system === awaited)) return;
    const name = awaited;
    awaited = null;
    navigate({ page: "system", name }, { replace: true });
  }, [working.systems]);
  return null;
}

export function NewSystem({ working }: { working: Snapshot }) {
  return (
    <Popup
      title="New system"
      className="nav-add"
      label={
        <>
          <Plus size={14} aria-hidden />
          <span className="sr-only">New system</span>
        </>
      }
      focus="field"
    >
      {(panel) => <SystemForm working={working} editing={null} panel={panel} />}
    </Popup>
  );
}

export function SystemSettings({ system, working }: { system: SnapshotSystem; working: Snapshot }) {
  return (
    <Popup
      title={`${system.system} settings`}
      className="system-settings"
      label={
        <>
          <SlidersHorizontal size={16} aria-hidden />
          <span className="sr-only">System settings</span>
        </>
      }
      focus="panel"
    >
      {(panel) => <SystemForm working={working} editing={system} panel={panel} />}
    </Popup>
  );
}

const NEW_NAME = /^[A-Za-z][\w-]*(\.[A-Za-z][\w-]*)*$/;
const RENAMED = /^[A-Za-z][\w-]*$/;

function firstProblem(error: unknown): string {
  const message = (error as Error).message;
  return message.split("\n").find((line) => line.startsWith("- "))?.slice(2) ?? message;
}

function rolesUsing(system: SnapshotSystem): string[] {
  return [...new Set(system.steps.flatMap((step) => step.usedBy.map((use) => [use.group, use.role].filter(Boolean).join("."))))];
}

type Attempt =
  | { status: "unchanged" }
  | { status: "refused"; problem: string }
  | { status: "ready"; edits: Edit[]; opens: string | null; recipe: Recipe | null };

/** One form for a system's name and algorithm: a new system's, or with `editing` an existing one's, where it can also be removed. */
function SystemForm({ working, editing, panel }: { working: Snapshot; editing: SnapshotSystem | null; panel: PopupPanel }) {
  const { commitStep, commit } = useTrying();
  const group = editing ? editing.system.split(".").slice(0, -1) : [];
  const [name, setName] = useState(editing ? editing.system.split(".").at(-1)! : "");
  const [algorithm, setAlgorithm] = useState(editing?.algorithm ?? builtinAlgorithms[0].name);
  const [removal, setRemoval] = useState<string | null>(null);
  const chosen = builtinAlgorithms.find((candidate) => candidate.name === algorithm);

  const attempt = useMemo<Attempt>(() => {
    if (name === "" || !chosen) return { status: "unchanged" };
    const edits: Edit[] = [];
    let opens: string | null = null;
    let recipe: Recipe | null = null;
    if (!editing) {
      if (!NEW_NAME.test(name)) return { status: "refused", problem: "A name is letters, digits, - and _, starting with a letter; a dot puts it in a group." };
      recipe = recipeOf(working, chosen, null);
      edits.push({ action: "add", target: { kind: "system", path: name }, value: JSON.stringify({ algorithm, params: recipe.params }) });
      opens = name;
    } else {
      const target: SystemTarget = { kind: "system", path: editing.system };
      if (algorithm !== editing.algorithm) {
        recipe = recipeOf(working, chosen, editing);
        edits.push({ action: "set", target, value: JSON.stringify({ algorithm, params: recipe.params }) });
      }
      if (name !== editing.system.split(".").at(-1)) {
        if (!RENAMED.test(name)) return { status: "refused", problem: "A name is letters, digits, - and _, starting with a letter." };
        edits.push({ action: "rename", target, name });
        opens = [...group, name].join(".");
      }
    }
    if (edits.length === 0) return { status: "unchanged" };
    try {
      previewOf(working, edits);
    } catch (e) {
      return { status: "refused", problem: firstProblem(e) };
    }
    return { status: "ready", edits, opens, recipe };
  }, [working, editing, name, algorithm]);

  const remove = () => {
    if (!editing) return;
    const roles = rolesUsing(editing);
    if (roles.length > 0) {
      setRemoval(`Used by ${roles.slice(0, 3).join(", ")}${roles.length > 3 ? ` and ${roles.length - 3} more` : ""}. Point ${roles.length === 1 ? "it" : "them"} elsewhere first.`);
      return;
    }
    const edit: Edit = { action: "remove", target: { kind: "system", path: editing.system } };
    try {
      previewOf(working, [edit]);
    } catch (e) {
      setRemoval(firstProblem(e));
      return;
    }
    commit(edit);
    navigate({ page: "definition" }, { replace: true });
    panel.dismiss();
  };

  const recipe = attempt.status === "ready" ? attempt.recipe : null;
  return (
    <form
      className="ref-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (attempt.status !== "ready") return;
        awaited = attempt.opens;
        commitStep(attempt.edits);
        panel.dismiss();
      }}
    >
      <div className="editor-head" {...panel.handle}>
        <span className="ref-editor-heading">{editing ? editing.system : "New system"}</span>
        {panel.close}
      </div>
      <label className="ref-control">
        <span>system</span>
        <input
          type="text"
          className="ref-input"
          value={name}
          spellCheck={false}
          autoComplete="off"
          data-1p-ignore
          placeholder="brand"
          onChange={(event) => setName(event.target.value.trim())}
        />
      </label>
      <label className="ref-control">
        <span>algorithm</span>
        <select value={algorithm} onChange={(event) => setAlgorithm(event.target.value)}>
          {!chosen && <option>{algorithm}</option>}
          {builtinAlgorithms.map((candidate) => (
            <option key={candidate.name}>{candidate.name}</option>
          ))}
        </select>
      </label>
      {chosen && <p className="muted system-form-note">{chosen.description}</p>}
      {editing && recipe && (
        <p className="system-form-note">
          {recipe.kept.length > 0 && <>Keeps {recipe.kept.join(", ")}. </>}
          {recipe.started.length > 0 && <>Starts {recipe.started.join(", ")} on {working.constants[0]?.path ?? DEFAULT_START}. </>}
          {recipe.dropped.length > 0 && <>Drops {recipe.dropped.join(", ")}.</>}
        </p>
      )}
      {attempt.status === "refused" && <p className="ref-error system-form-problem">{attempt.problem}</p>}
      <div className="system-form-actions">
        <button type="submit" className="btn btn-primary" disabled={attempt.status !== "ready"}>
          {editing ? "Apply" : "Add system"}
        </button>
        {editing && (
          <button type="button" className="btn system-form-remove" onClick={remove}>
            Remove
          </button>
        )}
      </div>
      {removal && <p className="ref-error system-form-problem">{removal}</p>}
    </form>
  );
}
