import { isMap, isScalar, isSeq, parseDocument, Scalar, type Document, type YAMLSeq } from "yaml";
import { INHERIT } from "./selector.js";

/** One value written in a definition: an authored color, or the ref a role holds for a mode. */
export type EditTarget =
  | { kind: "constant"; path: string }
  | { kind: "param"; system: string; path: string }
  /** A param written once in `defaults` and shared by every system of that algorithm. */
  | { kind: "default"; algorithm: string; path: string }
  /** `role` is the role's dotted path within its section; `mode` its place in `modes`. */
  | { kind: "ref"; section: string; role: string; mode: number };

/** For a ref, `INHERIT` is a value too: the mode says nothing and follows the one it extends. */
export type Edit = { target: EditTarget; value: string };

function keysOf(target: EditTarget, doc: Document): (string | number)[] {
  switch (target.kind) {
    case "constant":
      return ["systems", ...target.path.split(".")];
    case "param":
      return ["systems", ...target.system.split("."), "params", ...target.path.split(".")];
    case "default":
      return ["defaults", target.algorithm, ...target.path.split(".")];
    case "ref": {
      const role = [target.section, ...target.role.split(".")];
      const written = doc.getIn(role, true);
      // A role is a ref list, a block holding one under `refs`, or — in a
      // definition without modes — the ref itself.
      if (isMap(written)) return [...role, "refs", target.mode];
      return isSeq(written) ? [...role, target.mode] : role;
    }
  }
}

export function describeTarget(target: EditTarget): string {
  switch (target.kind) {
    case "constant":
      return target.path;
    case "param":
      return `${target.system} ${target.path}`;
    case "default":
      return `the shared ${target.algorithm} ${target.path}`;
    case "ref":
      return `${target.role}, mode ${target.mode + 1}`;
  }
}

/** A value as YAML source, in the quoting the value it replaces was written in where that is safe. */
function sourceFor(value: string, replaced: Scalar): string {
  if (replaced.type === Scalar.QUOTE_SINGLE && !value.includes("'")) return `'${value}'`;
  // Unquoted, `#` starts a comment and flow punctuation ends the value.
  const plainSafe = /^[A-Za-z][\w().%/ -]*$/.test(value) && !value.endsWith(" ");
  if (replaced.type === Scalar.PLAIN && plainSafe) return value;
  return JSON.stringify(value);
}

/**
 * The definition with each edit's value written at its target. The new value
 * is spliced over the old one's exact span in the text, so the result differs
 * from the input by that value and nothing else — the diff a person editing
 * the file by hand would have produced. Re-serialising the parsed document
 * would instead restyle every flow collection in the file.
 */
export function applyEdits(yamlText: string, edits: Edit[]): string {
  let text = yamlText;
  for (const edit of edits) {
    const node = nodeAt(text, edit.target);
    if (node) {
      const [start, end] = node.range;
      const source = edit.value === INHERIT && edit.target.kind === "ref" ? INHERIT : sourceFor(edit.value, node);
      text = text.slice(0, start) + source + text.slice(end);
      continue;
    }
    const lastRef = lastRefBefore(text, edit.target);
    if (!lastRef) {
      throw new Error(`nothing written for ${describeTarget(edit.target)} to edit`);
    }
    if (edit.value === INHERIT) continue;
    text = withRefsAdded(text, lastRef, [
      ...Array<string>(lastRef.missing).fill(INHERIT),
      sourceFor(edit.value, lastRef.node),
    ]);
  }
  return text;
}

/**
 * The value written at a target, or null when the definition has nothing
 * there. A mode a role says nothing for reads as `INHERIT`, whether a `~`
 * holds its place or the list stops short of it.
 */
export function readValue(yamlText: string, target: EditTarget): string | null {
  const node = nodeAt(yamlText, target);
  if (node) return node.value == null ? INHERIT : String(node.value);
  return lastRefBefore(yamlText, target) ? INHERIT : null;
}

type Located = Scalar & { range: NonNullable<Scalar["range"]> };

function nodeAt(yamlText: string, target: EditTarget): Located | null {
  const doc = parseDocument(yamlText);
  const keys = keysOf(target, doc);
  // `toward.0` names a list item; the document wants that index as a number.
  keys.forEach((key, depth) => {
    if (isSeq(doc.getIn(keys.slice(0, depth), true))) keys[depth] = Number(key);
  });
  const node = doc.getIn(keys, true);
  if (!isScalar(node) || !node.range) return null;
  // A `~` holds a mode's place in a ref list and can be written over.
  // Anywhere else an empty value is nothing to edit.
  if (node.value == null && target.kind !== "ref") return null;
  return node as Located;
}

type LastRef = { node: Located; inFlowList: boolean; missing: number };

/**
 * For a mode past the end of a role's ref list: the list's last ref, and how
 * many modes lie between it and the target. Null when the target is not one.
 */
function lastRefBefore(yamlText: string, target: EditTarget): LastRef | null {
  if (target.kind !== "ref") return null;
  const doc = parseDocument(yamlText);
  const role = [target.section, ...target.role.split(".")];
  const written = doc.getIn(role, true);
  const refs = isMap(written) ? written.get("refs", true) : written;
  if (!isSeq(refs) || target.mode < refs.items.length) return null;
  const last = refs.items.at(-1);
  if (!isScalar(last) || !last.range) return null;
  return {
    node: last as Located,
    inFlowList: (refs as YAMLSeq).flow === true,
    missing: target.mode - refs.items.length,
  };
}

function withRefsAdded(text: string, last: LastRef, sources: string[]): string {
  const [itemStart, itemEnd] = last.node.range;
  if (last.inFlowList) {
    const added = sources.map((source) => `, ${source}`).join("");
    return text.slice(0, itemEnd) + added + text.slice(itemEnd);
  }
  // A block list item owns its line, trailing comment included, so the new
  // items go after the line and repeat its indent and dash.
  const lineStart = text.lastIndexOf("\n", itemStart) + 1;
  const dash = text.slice(lineStart, itemStart);
  const nextLine = text.indexOf("\n", itemEnd);
  const lineEnd = nextLine === -1 ? text.length : nextLine;
  const added = sources.map((source) => `\n${dash}${source}`).join("");
  return text.slice(0, lineEnd) + added + text.slice(lineEnd);
}
