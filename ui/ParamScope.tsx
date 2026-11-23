import type { Edit } from "../src/engine/edit.js";

/** Where a top-level param's value is read from, and what it would fall back to if the system stopped writing it. */
export type ParamScope = {
  system: string;
  algorithm: string;
  path: string;
  from: "system" | "defaults" | "built-in";
  /** Null when the system's own value has nothing underneath it, such as a required color. */
  fallback: "defaults" | "built-in" | null;
  /** Set when the panel edits one item of a list param, which is unlinked and reset with its whole list. `shorthand` lists, one value per end, are written as one value when every item is the same. */
  item?: { index: number; list: unknown[]; shorthand?: boolean } | null;
};

/** Copies a value from `defaults` onto the system as its own, `value` being the one the panel opened on; an item copies its whole list. */
export function unlinkEdit(scope: ParamScope, value: string): Edit {
  return {
    action: "set",
    target: { kind: "param", system: scope.system, path: scope.path },
    value: !scope.item ? value : scope.item.shorthand && scope.item.list.every((other) => other === scope.item!.list[0]) ? String(scope.item.list[0]) : JSON.stringify(scope.item.list),
  };
}

/**
 * The line under a param's panel heading saying where an edit goes, with the
 * one action that changes it: unlink a value from `defaults` onto this
 * system, or reset the system's own value to what is under it.
 */
export function ParamScopeControl({
  scope,
  unlink,
  fallBack,
}: {
  scope: ParamScope | null;
  /** Makes the system's own copy of the value, as its own change; the panel goes on editing that copy. */
  unlink: () => void;
  /** Makes the removal of the system's own value, and closes the panel. */
  fallBack: (edit: Edit) => void;
}) {
  const action = scopeAction(scope, unlink, fallBack);
  return action && <div className="param-scope">{action}</div>;
}

function scopeAction(scope: ParamScope | null, unlink: () => void, fallBack: (edit: Edit) => void) {
  if (!scope) return null;
  if (scope.from === "defaults") {
    return (
      <div className="param-scope-row">
        <span>
          Editing <code>defaults</code>
        </span>
        <button type="button" className="param-scope-action" title={`Copy ${scope.path} onto ${scope.system} and edit it there`} onClick={unlink}>
          Unlink
        </button>
      </div>
    );
  }
  if (scope.from === "system" && scope.fallback) {
    return (
      <div className="param-scope-row">
        <button
          type="button"
          className="param-scope-action"
          onClick={() => fallBack({ action: "remove", target: { kind: "param", system: scope.system, path: scope.path } })}
        >
          {scope.fallback === "defaults" ? "Reset to defaults" : "Reset to built-in"}
        </button>
      </div>
    );
  }
  return null;
}
