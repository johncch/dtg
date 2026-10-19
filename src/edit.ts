import { isMap, isScalar, isSeq, parseDocument, Scalar, type Document, type Node, type Pair, type YAMLMap, type YAMLSeq } from "yaml";
import { INHERIT } from "./selector.js";

/** One value written in a definition: an authored color, or the ref a role holds for a mode. */
export type EditTarget =
  | { kind: "constant"; path: string }
  | { kind: "param"; system: string; path: string }
  /** A param written once in `defaults` and shared by every system of that algorithm. */
  | { kind: "default"; algorithm: string; path: string }
  /** `role` is the role's dotted path within its section; `mode` its place in `modes`. */
  | { kind: "ref"; section: string; role: string; mode: number };

export type ConstantTarget = Extract<EditTarget, { kind: "constant" }>;

/**
 * Setting writes a value; for a ref, `INHERIT` is a value too: the mode says
 * nothing and follows the one it extends. Setting needs a value to write over;
 * a constant the file does not have is added instead. A constant can also be
 * renamed within its group, or removed.
 */
export type Edit =
  | { action: "set"; target: EditTarget; value: string }
  | { action: "add"; target: ConstantTarget; value: string }
  | { action: "rename"; target: ConstantTarget; name: string }
  | { action: "remove"; target: ConstantTarget };

/** Where a constant is after it is renamed. */
export function renamedTarget(target: ConstantTarget, name: string): ConstantTarget {
  return { kind: "constant", path: [...target.path.split(".").slice(0, -1), name].join(".") };
}

function keysOf(target: EditTarget, doc: Document): (string | number)[] {
  switch (target.kind) {
    case "constant":
      return ["palette", ...target.path.split(".")];
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
  // A number written bare stays a number; quoting it would make it a string.
  if (replaced.type === Scalar.PLAIN && typeof replaced.value === "number" && /^-?\d+(\.\d+)?$/.test(value)) return value;
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
    if (edit.action === "rename") {
      text = withConstantRenamed(text, edit.target, edit.name);
      continue;
    }
    if (edit.action === "remove") {
      text = withConstantRemoved(text, edit.target);
      continue;
    }
    if (edit.action === "add") {
      text = withConstantAdded(text, edit.target, edit.value);
      continue;
    }
    const structure = structureSource(edit.value) != null ? structureAt(text, edit.target) : null;
    if (structure) {
      text = text.slice(0, structure.start) + structureSource(edit.value) + text.slice(structure.end);
      continue;
    }
    const node = nodeAt(text, edit.target);
    if (node) {
      const [start, end] = node.range;
      const source = edit.value === INHERIT && edit.target.kind === "ref" ? INHERIT : sourceFor(edit.value, node);
      text = text.slice(0, start) + source + text.slice(end);
      continue;
    }
    if (edit.target.kind === "param" && !edit.target.path.includes(".")) {
      text = withParamAdded(text, edit.target, edit.value);
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
  if (structureAt(yamlText, target)) return JSON.stringify((writtenAt(yamlText, target) as YAMLMap | YAMLSeq).toJSON());
  const node = nodeAt(yamlText, target);
  if (node) return node.value == null ? INHERIT : String(node.value);
  return lastRefBefore(yamlText, target) ? INHERIT : null;
}

type Located = Scalar & { range: NonNullable<Scalar["range"]> };

function writtenAt(yamlText: string, target: EditTarget): unknown {
  const doc = parseDocument(yamlText);
  const keys = keysOf(target, doc);
  // `toward.0` names a list item; the document wants that index as a number.
  keys.forEach((key, depth) => {
    if (isSeq(doc.getIn(keys.slice(0, depth), true))) keys[depth] = Number(key);
  });
  return doc.getIn(keys, true);
}

/** A list or map written at a param, as the span its contents occupy. */
function structureAt(yamlText: string, target: EditTarget): { start: number; end: number } | null {
  if (target.kind !== "param" && target.kind !== "default") return null;
  const node = writtenAt(yamlText, target);
  if (!(isSeq(node) || isMap(node)) || !node.range) return null;
  return { start: node.range[0], end: node.flow ? node.range[1] : lastWrittenEnd(node) };
}

/**
 * A list or map value, given as JSON — `[[0.3, 0.1, 0.6, 1], [0, 0, 1, 1]]`,
 * `{"from": 0.97, "to": 0.25}` — as flow YAML; null when the value is neither.
 */
function structureSource(value: string): string | null {
  if (!value.startsWith("[") && !value.startsWith("{")) return null;
  const flow = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(flow).join(", ")}]`;
    if (item != null && typeof item === "object") {
      return `{ ${Object.entries(item).map(([key, inner]) => `${keySource(key)}: ${flow(inner)}`).join(", ")} }`;
    }
    return typeof item === "number" ? String(item) : JSON.stringify(item);
  };
  return flow(JSON.parse(value));
}

function nodeAt(yamlText: string, target: EditTarget): Located | null {
  const node = writtenAt(yamlText, target);
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

/** A new constant at the end of its group, or of `palette` for one in no group. */
function withConstantAdded(text: string, target: ConstantTarget, value: string): string {
  const keys = ["palette", ...target.path.split(".")];
  return withEntryAdded(text, keys.slice(0, -1), keys.at(-1)!, JSON.stringify(value), target, "and is not a color");
}

/** A param the system does not write yet, added to its `params` block: the algorithm's default stops applying. */
function withParamAdded(text: string, target: Extract<EditTarget, { kind: "param" }>, value: string): string {
  const source = /^-?\d+(\.\d+)?$/.test(value) ? value : (structureSource(value) ?? JSON.stringify(value));
  return withEntryAdded(text, ["systems", ...target.system.split("."), "params"], target.path, source, target, "but not as a value");
}

/**
 * A new entry at the end of a map. In a block map it goes on its own line,
 * past everything the last entry holds, at the indent the map's entries are
 * written at.
 */
function withEntryAdded(
  text: string,
  mapKeys: string[],
  name: string,
  valueSource: string,
  target: EditTarget,
  alreadyWritten: string,
): string {
  const set = parseDocument(text).getIn(mapKeys, true);
  if (!isMap(set) || !set.range) {
    throw new Error(`nothing written for ${describeTarget(target)} to be added to`);
  }
  if (set.items.some((item) => isScalar(item.key) && item.key.value === name)) {
    throw new Error(`${describeTarget(target)} is already written, ${alreadyWritten}`);
  }
  const entry = `${keySource(name)}: ${valueSource}`;
  if (set.flow) {
    const brace = text.lastIndexOf("}", set.range[1]);
    const end = set.range[0] + text.slice(set.range[0], brace).trimEnd().length;
    if (set.items.length === 0) return `${text.slice(0, end)} ${entry} ${text.slice(brace)}`;
    return `${text.slice(0, end)}, ${entry}${text.slice(end)}`;
  }
  const firstKey = set.items[0].key as Node;
  const keyStart = firstKey.range![0];
  const indent = text.slice(text.lastIndexOf("\n", keyStart) + 1, keyStart);
  const nextLine = text.indexOf("\n", lastWrittenEnd(set));
  const lineEnd = nextLine === -1 ? text.length : nextLine;
  return `${text.slice(0, lineEnd)}\n${indent}${entry}${text.slice(lineEnd)}`;
}

/** Where the last value written inside a node ends. A block collection's own range runs on to the next key, so it is no use. */
function lastWrittenEnd(node: Node): number {
  if (isMap(node) && node.items.length > 0) {
    const last = node.items.at(-1)!;
    return lastWrittenEnd((last.value ?? last.key) as Node);
  }
  if (isSeq(node) && node.items.length > 0) return lastWrittenEnd(node.items.at(-1) as Node);
  return node.range![1];
}

function keySource(name: string): string {
  return /^[A-Za-z][\w-]*$/.test(name) ? name : JSON.stringify(name);
}

type ConstantEntry = { doc: Document; keys: string[]; set: YAMLMap; pair: Pair<Scalar & { range: NonNullable<Scalar["range"]> }, Node> };

/** The constant a target names, with the group it is in. Throws when the file has no such constant. */
function constantAt(text: string, target: ConstantTarget): ConstantEntry {
  const doc = parseDocument(text);
  const keys = ["palette", ...target.path.split(".")];
  const set = doc.getIn(keys.slice(0, -1), true);
  const pair = isMap(set) ? set.items.find((item) => isScalar(item.key) && item.key.value === keys.at(-1)) : undefined;
  if (!isMap(set) || !pair || !isScalar(pair.value) || !isScalar(pair.key) || !pair.key.range) {
    throw new Error(`nothing written for ${describeTarget(target)} to edit`);
  }
  return { doc, keys, set, pair: pair as ConstantEntry["pair"] };
}

function withConstantRenamed(text: string, target: ConstantTarget, name: string): string {
  const { set, pair } = constantAt(text, target);
  if (set.items.some((item) => isScalar(item.key) && item.key.value === name)) {
    throw new Error(`${describeTarget(renamedTarget(target, name))} is already written`);
  }
  const from = target.path;
  const to = renamedTarget(target, name).path;
  const spans: { start: number; end: number; source: string }[] = [
    { start: pair.key.range[0], end: pair.key.range[1], source: keySource(name) },
  ];
  for (const { node, renamed } of pointersAt(parseDocument(text).contents, [], from, to)) {
    spans.push({ start: node.range![0], end: node.range![1], source: sourceFor(renamed, node) });
  }
  return spans
    .sort((a, b) => b.start - a.start)
    .reduce((written, { start, end, source }) => written.slice(0, start) + source + written.slice(end), text);
}

/**
 * Every value that points at the constant `from`, with what it says once the
 * constant is `to`: a role's ref, `transparent(from …)`, or a color param.
 * Only where refs and params are written — an `alias` or a changelog note
 * that happens to read the same is left alone.
 */
function pointersAt(node: unknown, keys: string[], from: string, to: string): { node: Scalar; renamed: string }[] {
  if (isMap(node)) {
    return node.items.flatMap((pair) => {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      return pointersAt(pair.value, [...keys, key], from, to);
    });
  }
  if (isSeq(node)) return node.items.flatMap((item) => pointersAt(item, keys, from, to));
  if (!isScalar(node) || typeof node.value !== "string" || !node.range) return [];
  const [top] = keys;
  if (keys.includes("alias") || ["dtg", "modes", "palette", "changelog"].includes(top)) return [];
  if (top === "systems" && !keys.includes("params")) return [];
  if (node.value === from) return [{ node, renamed: to }];
  const faded = /^transparent\(\s*(\S+)(\s[^)]*)?\)$/.exec(node.value);
  if (faded?.[1] === from) return [{ node, renamed: `transparent(${to}${faded[2] ?? ""})` }];
  return [];
}

/**
 * The constant and its line go. A group left with nothing is written as `{}`,
 * so it stays a group to add to rather than becoming an empty value.
 */
function withConstantRemoved(text: string, target: ConstantTarget): string {
  const { doc, keys, set, pair } = constantAt(text, target);
  const index = set.items.indexOf(pair);
  const valueEnd = (pair.value as Node).range![1];
  if (set.items.length === 1) {
    const holderKeys = keys.slice(0, -2);
    const holder = holderKeys.length === 0 ? doc.contents : doc.getIn(holderKeys, true);
    const holding = isMap(holder) ? holder.items.find((item) => item.value === set) : undefined;
    const holdingKey = holding?.key as Node | undefined;
    if (!holdingKey?.range) throw new Error(`nothing written for ${describeTarget(target)} to edit`);
    const end = set.flow ? text.indexOf("}", valueEnd) + 1 : lineEndAfter(text, valueEnd);
    return `${text.slice(0, holdingKey.range[1])}: {}${text.slice(end)}`;
  }
  if (set.flow) {
    if (index === 0) {
      const next = set.items[1].key as Node;
      return text.slice(0, pair.key.range[0]) + text.slice(next.range![0]);
    }
    const previousEnd = lastWrittenEnd(set.items[index - 1].value as Node);
    return text.slice(0, previousEnd) + text.slice(valueEnd);
  }
  const lineStart = text.lastIndexOf("\n", pair.key.range[0]) + 1;
  const lineEnd = lineEndAfter(text, valueEnd);
  return lineEnd === text.length
    ? text.slice(0, Math.max(lineStart - 1, 0))
    : text.slice(0, lineStart) + text.slice(lineEnd + 1);
}

function lineEndAfter(text: string, at: number): number {
  const nextLine = text.indexOf("\n", at);
  return nextLine === -1 ? text.length : nextLine;
}
