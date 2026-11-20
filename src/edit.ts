import { isAlias, isMap, isScalar, isSeq, parseDocument, Scalar, type Document, type Node, type Pair, type YAMLMap, type YAMLSeq } from "yaml";
import { INHERIT } from "./selector.js";

/** One value written in a definition: an authored color, or the ref a role holds for a mode. */
export type EditTarget =
  | { kind: "constant"; path: string }
  /** A whole system, by its dotted path under `systems`. */
  | { kind: "system"; path: string }
  /** The selectors a system publishes whether or not a ref asks, as a JSON list; an empty one takes `emit` out. */
  | { kind: "emit"; system: string }
  | { kind: "param"; system: string; path: string }
  /** A param written once in `defaults` and shared by every system of that algorithm. */
  | { kind: "default"; algorithm: string; path: string }
  /** `role` is the role's dotted path within its section; `mode` its place in `modes`. */
  | { kind: "ref"; section: string; role: string; mode: number }
  /** A whole role, by its dotted path within its section. */
  | { kind: "role"; section: string; role: string };

export type ConstantTarget = Extract<EditTarget, { kind: "constant" }>;
export type SystemTarget = Extract<EditTarget, { kind: "system" }>;
export type RoleTarget = Extract<EditTarget, { kind: "role" }>;
type EmitTarget = Extract<EditTarget, { kind: "emit" }>;
/** What is added, renamed and removed whole. */
export type EntryTarget = ConstantTarget | SystemTarget | RoleTarget;

/**
 * Setting writes a value; for a ref, `INHERIT` is a value too: the mode says
 * nothing and follows the one it extends. Setting needs a value to write over;
 * a constant the file does not have is added instead, at the end of its group
 * or after the sibling `after` names. A constant can also be renamed within
 * its group, moved to follow another of its group (`after` null puts it
 * first), or removed. A system is added and removed whole, and renamed
 * within its group: its value is `{ "algorithm", "params" }` as JSON, and
 * setting it writes both, leaving the system's other keys as they are.
 * A role is added at the end of its group, renamed within it, and removed
 * whole: its value is its refs, one per mode, as a JSON list.
 */
export type Edit =
  | { action: "set"; target: EditTarget; value: string }
  | { action: "add"; target: EntryTarget; value: string; after?: string }
  | { action: "rename"; target: EntryTarget; name: string }
  | { action: "move"; target: ConstantTarget; after: string | null }
  | { action: "remove"; target: EntryTarget };

/** Where a constant, a system or a role is after it is renamed. */
export function renamedTarget<Target extends EntryTarget>(target: Target, name: string): Target {
  const renamed = (path: string) => [...path.split(".").slice(0, -1), name].join(".");
  return target.kind === "role" ? { ...target, role: renamed(target.role) } : { ...target, path: renamed(target.path) };
}

function keysOf(target: EditTarget, doc: Document): (string | number)[] {
  switch (target.kind) {
    case "constant":
      return ["palette", ...target.path.split(".")];
    case "system":
      return ["systems", ...target.path.split(".")];
    case "emit":
      return ["systems", ...target.system.split("."), "emit"];
    case "param":
      return ["systems", ...target.system.split("."), "params", ...target.path.split(".")];
    case "default":
      return ["defaults", target.algorithm, ...target.path.split(".")];
    case "role":
      return [target.section, ...target.role.split(".")];
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
    case "system":
      return target.path;
    case "emit":
      return `${target.system} emit`;
    case "param":
      return `${target.system} ${target.path}`;
    case "default":
      return `the shared ${target.algorithm} ${target.path}`;
    case "ref":
      return `${target.role}, mode ${target.mode + 1}`;
    case "role":
      return target.role;
  }
}

/** Unquoted, `#` starts a comment and flow punctuation ends the value; this is what can go without quotes. */
function plainSafe(value: string): boolean {
  return /^[A-Za-z][\w().%/ -]*$/.test(value) && !value.endsWith(" ");
}

/** A value as YAML source, in the quoting the value it replaces was written in where that is safe. */
function sourceFor(value: string, replaced: Scalar): string {
  if (replaced.type === Scalar.QUOTE_SINGLE && !value.includes("'")) return `'${value}'`;
  // A number written bare stays a number; quoting it would make it a string.
  if (replaced.type === Scalar.PLAIN && typeof replaced.value === "number" && /^-?\d+(\.\d+)?$/.test(value)) return value;
  if (replaced.type === Scalar.PLAIN && plainSafe(value)) return value;
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
      text = withEntryRenamed(text, edit.target, edit.name);
      continue;
    }
    if (edit.action === "move") {
      text = withConstantMoved(text, edit.target, edit.after);
      continue;
    }
    if (edit.action === "remove") {
      text = edit.target.kind === "role" ? withRoleRemoved(text, edit.target) : withEntryRemoved(text, edit.target);
      continue;
    }
    if (edit.action === "add") {
      text =
        edit.target.kind === "system"
          ? withSystemAdded(text, edit.target, edit.value)
          : edit.target.kind === "role"
            ? withRoleAdded(text, edit.target, edit.value)
            : withConstantAdded(text, edit.target, edit.value, edit.after);
      continue;
    }
    if (edit.target.kind === "role") {
      throw new Error(`${describeTarget(edit.target)} is edited one ref at a time`);
    }
    if (edit.target.kind === "system") {
      text = withSystemSet(text, edit.target, edit.value);
      continue;
    }
    if (edit.target.kind === "emit") {
      text = withEmitSet(text, edit.target, edit.value);
      continue;
    }
    const alias = aliasOnTheWay(text, edit.target);
    if (alias) {
      throw new Error(
        `${describeTarget(edit.target)} is \`*${alias.name}\`, a YAML alias of the value anchored at ${alias.anchoredAt ?? `\`&${alias.name}\``} — edit it there, which changes every place it is used, or write a value of its own here`,
      );
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
  if (target.kind === "system") {
    const system = writtenAt(yamlText, target);
    if (!isSystem(system)) return null;
    const { algorithm, params } = system.toJSON() as { algorithm: string; params?: Record<string, unknown> };
    return JSON.stringify({ algorithm, params: params ?? {} });
  }
  if (target.kind === "emit") {
    const emit = writtenAt(yamlText, target);
    return isSeq(emit) ? JSON.stringify(emit.toJSON()) : null;
  }
  if (target.kind === "role") {
    const refs = refsOf(writtenAt(yamlText, target));
    return refs == null ? null : JSON.stringify(refs);
  }
  if (structureAt(yamlText, target)) return JSON.stringify((writtenAt(yamlText, target) as YAMLMap | YAMLSeq).toJSON());
  const node = nodeAt(yamlText, target);
  if (node) return node.value == null ? INHERIT : String(node.value);
  return lastRefBefore(yamlText, target) ? INHERIT : null;
}

type Located = Scalar & { range: NonNullable<Scalar["range"]> };

/**
 * An alias on the way to a target, and where its anchor is written. Writing
 * through one would either change every place the anchor is used or nothing,
 * and which is meant is not the editor's to guess.
 */
function aliasOnTheWay(yamlText: string, target: EditTarget): { name: string; anchoredAt: string | null } | null {
  const doc = parseDocument(yamlText);
  const keys = keysOf(target, doc);
  for (let depth = 1; depth <= keys.length; depth++) {
    const node = doc.getIn(keys.slice(0, depth), true);
    if (isAlias(node)) return { name: node.source, anchoredAt: anchorPath(doc.contents, node.source) };
    if (isSeq(node) && depth < keys.length) keys[depth] = Number(keys[depth]);
  }
  return null;
}

/** The dotted path of the value carrying `&name`, or null when no value in the document does. */
function anchorPath(node: unknown, name: string, keys: string[] = []): string | null {
  const entries: [string, unknown][] = isMap(node)
    ? node.items.map((pair) => [isScalar(pair.key) ? String(pair.key.value) : "?", pair.value])
    : isSeq(node)
      ? node.items.map((item, index) => [String(index), item])
      : [];
  for (const [key, value] of entries) {
    if ((value as Node | null)?.anchor === name) return [...keys, key].join(".");
    const found = anchorPath(value, name, [...keys, key]);
    if (found) return found;
  }
  return null;
}

/** For a system's own params: which carry an anchor (`&name`) other values share, and which are aliases (`*name`) of one. */
export type ParamAnchor = { name: string; role: "anchor" | "alias" };

export function anchorsOf(doc: Document, system: string): Record<string, ParamAnchor> {
  const params = doc.getIn(["systems", ...system.split("."), "params"], true);
  if (!isMap(params)) return {};
  const found: Record<string, ParamAnchor> = {};
  for (const pair of params.items) {
    if (!isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    if (isAlias(pair.value)) found[key] = { name: pair.value.source, role: "alias" };
    else if ((pair.value as Node | null)?.anchor) found[key] = { name: (pair.value as Node).anchor!, role: "anchor" };
  }
  return found;
}

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
    if (typeof item === "number") return String(item);
    return typeof item === "string" && plainSafe(item) ? item : JSON.stringify(item);
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
function withConstantAdded(text: string, target: ConstantTarget, value: string, after?: string): string {
  const keys = ["palette", ...target.path.split(".")];
  return withEntryAdded(text, keys.slice(0, -1), keys.at(-1)!, JSON.stringify(value), target, "and is not a color", after);
}

/**
 * A new system at the end of its group, or of `systems` for one in no group.
 * In a block map it is written as a block, one key per line, with a blank
 * line before it where the map's other entries have one.
 */
function withSystemAdded(text: string, target: SystemTarget, value: string): string {
  const keys = ["systems", ...target.path.split(".")];
  const { algorithm, params } = JSON.parse(value) as { algorithm: string; params: Record<string, unknown> };
  const written = Object.keys(params).length > 0;
  const block = [`algorithm: ${algorithm}`, ...(written ? [`params: ${structureSource(JSON.stringify(params))}`] : [])];
  const flow = structureSource(JSON.stringify(written ? { algorithm, params } : { algorithm }))!;
  return withEntryAdded(text, keys.slice(0, -1), keys.at(-1)!, flow, target, "as a system or a group", undefined, block);
}

/** The system's algorithm and params written over the ones it has. A system that writes no params gains the block. */
function withSystemSet(text: string, target: SystemTarget, value: string): string {
  const { keys, pair } = entryAt(text, target);
  const system = pair.value as YAMLMap;
  const { algorithm, params } = JSON.parse(value) as { algorithm: string; params: Record<string, unknown> };
  const paramsSource = Object.keys(params).length > 0 ? structureSource(JSON.stringify(params))! : "{}";
  const algorithmNode = system.get("algorithm", true);
  const paramsNode = system.get("params", true);
  if (!isScalar(algorithmNode) || !algorithmNode.range || (paramsNode != null && !isMap(paramsNode))) {
    throw new Error(`nothing written for ${describeTarget(target)} to edit`);
  }
  const spans = [{ start: algorithmNode.range[0], end: algorithmNode.range[1], source: sourceFor(algorithm, algorithmNode) }];
  if (paramsNode) spans.push({ start: paramsNode.range![0], end: writtenEnd(paramsNode), source: paramsSource });
  const written = spans
    .sort((a, b) => b.start - a.start)
    .reduce((result, { start, end, source }) => result.slice(0, start) + source + result.slice(end), text);
  return paramsNode ? written : withEntryAdded(written, keys, "params", paramsSource, target, "but not as params", "algorithm");
}

function withEmitSet(text: string, target: EmitTarget, value: string): string {
  const listed = (JSON.parse(value) as unknown[]).length > 0;
  const emit = writtenAt(text, target);
  if (emit == null) {
    if (!listed) return text;
    return withEntryAdded(text, keysOf(target, parseDocument(text)).slice(0, -1) as string[], "emit", structureSource(value)!, target, "but not as a list");
  }
  if (!isSeq(emit) || !emit.range) throw new Error(`nothing written for ${describeTarget(target)} to edit`);
  if (!listed) return withEntryRemoved(text, target);
  return text.slice(0, emit.range[0]) + structureSource(value) + text.slice(writtenEnd(emit));
}

/**
 * A new role at the end of its group, or of its section for one in no group:
 * a ref list, or the ref itself in a definition without modes. A group the
 * section does not have yet is written with it, at the end of the section.
 */
function withRoleAdded(text: string, target: RoleTarget, value: string): string {
  const keys = [target.section, ...target.role.split(".")];
  const refs = JSON.parse(value) as string[];
  const written = refs.map((ref) => (ref === INHERIT || plainSafe(ref) ? ref : JSON.stringify(ref)));
  const doc = parseDocument(text);
  const source = doc.has("modes") ? `[${written.join(", ")}]` : written[0];
  const name = keys.at(-1)!;
  if (keys.length > 2 && doc.getIn(keys.slice(0, -1), true) == null) {
    const entry = `${keySource(name)}: ${source}`;
    return withEntryAdded(text, keys.slice(0, -2), keys.at(-2)!, `{ ${entry} }`, target, "as a role or a group", undefined, [entry]);
  }
  return withEntryAdded(text, keys.slice(0, -1), name, source, target, "as a role or a group");
}

/** A role's refs as written — a ref list, a block holding one under `refs`, or the ref itself — or null for anything else. */
function refsOf(node: unknown): unknown[] | null {
  const refs = isMap(node) ? node.get("refs", true) : node;
  if (isSeq(refs)) return refs.toJSON() as unknown[];
  return isScalar(refs) && refs.value != null ? [refs.value] : null;
}

function isSystem(node: unknown): node is YAMLMap {
  return isMap(node) && node.has("algorithm");
}

/** A param the system does not write yet, added to its `params` block: the algorithm's default stops applying. */
function withParamAdded(text: string, target: Extract<EditTarget, { kind: "param" }>, value: string): string {
  const source = /^-?\d+(\.\d+)?$/.test(value) || plainSafe(value) ? value : (structureSource(value) ?? JSON.stringify(value));
  return withEntryAdded(text, ["systems", ...target.system.split("."), "params"], target.path, source, target, "but not as a value");
}

/**
 * A new entry in a map: after the entry `after` names, or at the end when
 * there is none. In a block map it goes on its own line, past everything the
 * entry before it holds, at the indent the map's entries are written at.
 */
function withEntryAdded(
  text: string,
  mapKeys: string[],
  name: string,
  valueSource: string,
  target: EditTarget,
  alreadyWritten: string,
  after?: string,
  /** The value as the lines of a block, for an entry that holds a map of its own. */
  valueBlock?: string[],
): string {
  const set = parseDocument(text).getIn(mapKeys, true);
  if (!isMap(set) || !set.range) {
    throw new Error(`nothing written for ${describeTarget(target)} to be added to`);
  }
  if (set.items.some((item) => isScalar(item.key) && item.key.value === name)) {
    throw new Error(`${describeTarget(target)} is already written, ${alreadyWritten}`);
  }
  const entry = `${keySource(name)}: ${valueSource}`;
  const before = after == null ? undefined : set.items.find((item) => isScalar(item.key) && item.key.value === after);
  const beforeNode = before && ((before.value ?? before.key) as Node);
  if (set.flow) {
    if (beforeNode) {
      const end = beforeNode.range![1];
      return `${text.slice(0, end)}, ${entry}${text.slice(end)}`;
    }
    const brace = text.lastIndexOf("}", set.range[1]);
    const end = set.range[0] + text.slice(set.range[0], brace).trimEnd().length;
    if (set.items.length === 0) return `${text.slice(0, end)} ${entry} ${text.slice(brace)}`;
    return `${text.slice(0, end)}, ${entry}${text.slice(end)}`;
  }
  const firstKey = set.items[0].key as Node;
  const keyStart = firstKey.range![0];
  const indent = text.slice(text.lastIndexOf("\n", keyStart) + 1, keyStart);
  const nextLine = text.indexOf("\n", lastWrittenEnd(beforeNode ?? set));
  const lineEnd = nextLine === -1 ? text.length : nextLine;
  if (valueBlock) {
    const second = set.items[1]?.key as Node | undefined;
    const spaced = second != null && /\n[ \t]*\n/.test(text.slice(keyStart, second.range![0]));
    const lines = [`${keySource(name)}:`, ...valueBlock.map((line) => `  ${line}`)];
    return `${text.slice(0, lineEnd)}${spaced ? "\n" : ""}${lines.map((line) => `\n${indent}${line}`).join("")}${text.slice(lineEnd)}`;
  }
  return `${text.slice(0, lineEnd)}\n${indent}${entry}${text.slice(lineEnd)}`;
}

/** Where a value's own text ends: a flow collection at its closing bracket, anything else at the last value written inside it. */
function writtenEnd(node: Node): number {
  return (isMap(node) || isSeq(node)) && node.flow ? node.range![1] : lastWrittenEnd(node);
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

type Entry = { doc: Document; keys: string[]; set: YAMLMap; pair: Pair<Scalar & { range: NonNullable<Scalar["range"]> }, Node> };

/** The constant, system, role or emit list a target names, with the map it is in. Throws when the file has no such entry. */
function entryAt(text: string, target: EntryTarget | EmitTarget): Entry {
  const doc = parseDocument(text);
  const keys = keysOf(target, doc) as string[];
  const set = doc.getIn(keys.slice(0, -1), true);
  const pair = isMap(set) ? set.items.find((item) => isScalar(item.key) && item.key.value === keys.at(-1)) : undefined;
  const written =
    target.kind === "system"
      ? isSystem(pair?.value)
      : target.kind === "emit"
        ? isSeq(pair?.value)
        : target.kind === "role"
          ? refsOf(pair?.value) != null
          : isScalar(pair?.value);
  if (!isMap(set) || !pair || !written || !isScalar(pair.key) || !pair.key.range) {
    throw new Error(`nothing written for ${describeTarget(target)} to edit`);
  }
  return { doc, keys, set, pair: pair as Entry["pair"] };
}

function withEntryRenamed(text: string, target: EntryTarget, name: string): string {
  const { set, pair } = entryAt(text, target);
  if (set.items.some((item) => isScalar(item.key) && item.key.value === name)) {
    throw new Error(`${describeTarget(renamedTarget(target, name))} is already written`);
  }
  const pathOf = (entry: EntryTarget) => (entry.kind === "role" ? entry.role : entry.path);
  const from = pathOf(target);
  const to = pathOf(renamedTarget(target, name));
  const spans: { start: number; end: number; source: string }[] = [
    { start: pair.key.range[0], end: pair.key.range[1], source: keySource(name) },
  ];
  for (const { node, renamed } of pointersAt(parseDocument(text).contents, [], target.kind, from, to)) {
    spans.push({ start: node.range![0], end: node.range![1], source: sourceFor(renamed, node) });
  }
  return spans
    .sort((a, b) => b.start - a.start)
    .reduce((written, { start, end, source }) => written.slice(0, start) + source + written.slice(end), text);
}

/**
 * Every value that points at the constant `from`, with what it says once the
 * constant is `to`: a role's ref, `transparent(from …)`, or a color param.
 * For a system, every ref into it, `from(…)`; for a role, every other
 * role's ref to it, plain or `transparent(from …)`. Only where refs and params are
 * written — an `alias` or a changelog note that happens to read the same is
 * left alone.
 */
function pointersAt(
  node: unknown,
  keys: string[],
  kind: EntryTarget["kind"],
  from: string,
  to: string,
): { node: Scalar; renamed: string }[] {
  if (isMap(node)) {
    return node.items.flatMap((pair) => {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      return pointersAt(pair.value, [...keys, key], kind, from, to);
    });
  }
  if (isSeq(node)) return node.items.flatMap((item) => pointersAt(item, keys, kind, from, to));
  if (!isScalar(node) || typeof node.value !== "string" || !node.range) return [];
  const [top] = keys;
  if (keys.includes("alias") || ["dtg", "modes", "palette", "changelog"].includes(top)) return [];
  if (kind === "system") {
    if (top === "systems" || top === "defaults" || !node.value.startsWith(`${from}(`)) return [];
    return [{ node, renamed: to + node.value.slice(from.length) }];
  }
  if (kind === "role" && (top === "systems" || top === "defaults")) return [];
  if (top === "systems" && !keys.includes("params")) return [];
  if (node.value === from) return [{ node, renamed: to }];
  const faded = /^transparent\(\s*(\S+)(\s[^)]*)?\)$/.exec(node.value);
  if (faded?.[1] === from) return [{ node, renamed: `transparent(${to}${faded[2] ?? ""})` }];
  return [];
}

/**
 * The group's entries in a new order. Each entry's own text moves, a block
 * entry with the comment on its line; whatever is written between entries
 * stays where it is.
 */
function withConstantMoved(text: string, target: ConstantTarget, after: string | null): string {
  const { set, pair } = entryAt(text, target);
  const items: Pair[] = set.items;
  const others = items.filter((item) => item !== pair);
  const at = after == null ? 0 : others.findIndex((item) => isScalar(item.key) && item.key.value === after) + 1;
  if (after != null && at === 0) {
    throw new Error(`nothing written for ${describeTarget(target)} to follow`);
  }
  const order = [...others.slice(0, at), pair, ...others.slice(at)];
  const spans = items.map((item) => {
    const value = (item.value ?? item.key) as Node;
    const end = set.flow ? value.range![1] : lineEndAfter(text, lastWrittenEnd(value));
    return { start: (item.key as Node).range![0], end };
  });
  let moved = text.slice(0, spans[0].start);
  order.forEach((item, slot) => {
    const span = spans[items.indexOf(item)];
    moved += text.slice(span.start, span.end);
    if (slot + 1 < spans.length) moved += text.slice(spans[slot].end, spans[slot + 1].start);
  });
  return moved + text.slice(spans.at(-1)!.end);
}

/**
 * A group of roles is there while it holds one: removing its last role takes
 * the group with it, whatever it says about itself, and so on up to the
 * section, which stays.
 */
function withRoleRemoved(text: string, target: RoleTarget): string {
  const entry = entryAt(text, target);
  let { keys, set, pair } = entry;
  const holdsOnlyThis = () =>
    set.items.every((item) => item === pair || (isScalar(item.key) && ["alias", "omit", "description"].includes(String(item.key.value))));
  while (keys.length > 2 && holdsOnlyThis()) {
    keys = keys.slice(0, -1);
    const holder = entry.doc.getIn(keys.slice(0, -1), true) as YAMLMap;
    pair = holder.items.find((item) => item.value === set) as Entry["pair"];
    set = holder;
  }
  return withEntryRemoved(text, target, { doc: entry.doc, keys, set, pair }, keys.length < entry.keys.length);
}

/**
 * The entry and its lines go. A group left with nothing is written as `{}`,
 * so it stays a group to add to rather than becoming an empty value.
 */
function withEntryRemoved(
  text: string,
  target: EntryTarget | EmitTarget,
  { doc, keys, set, pair }: Entry = entryAt(text, target),
  /** Stands apart from its neighbors by a blank line; one of the two around it goes with it. */
  spaced = target.kind === "system",
): string {
  const index = set.items.indexOf(pair);
  const valueEnd = writtenEnd(pair.value as Node);
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
    const previousEnd = writtenEnd(set.items[index - 1].value as Node);
    return text.slice(0, previousEnd) + text.slice(valueEnd);
  }
  const lineStart = text.lastIndexOf("\n", pair.key.range[0]) + 1;
  const lineEnd = lineEndAfter(text, valueEnd);
  if (lineEnd === text.length) return text.slice(0, Math.max(lineStart - 1, 0));
  const blankBefore = spaced && /\n[ \t]*\n$/.test(text.slice(0, lineStart));
  const blankAfter = /^\n[ \t]*\n/.test(text.slice(lineEnd));
  if (blankBefore && text.slice(lineEnd).trim() === "") {
    return text.slice(0, lineStart).replace(/\n[ \t]*\n$/, "\n") + text.slice(lineEnd + 1);
  }
  const end = blankBefore && blankAfter ? text.indexOf("\n", lineEnd + 1) : lineEnd;
  return text.slice(0, lineStart) + text.slice(end + 1);
}

function lineEndAfter(text: string, at: number): number {
  const nextLine = text.indexOf("\n", at);
  return nextLine === -1 ? text.length : nextLine;
}
