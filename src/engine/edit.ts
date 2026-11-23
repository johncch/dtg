import { isAlias, isMap, isScalar, isSeq, parseDocument, Scalar, type Document, type Node, type Pair, type YAMLMap, type YAMLSeq } from "yaml";
import { TOP_LEVEL_RESERVED } from "./resolve.js";
import { INHERIT, ROOT } from "./selector.js";

/** One value written in a definition: an authored color, or the ref a role holds for a mode. */
export type EditTarget =
  | { kind: "constant"; path: string }
  /** A whole system, by its dotted path under `systems`. */
  | { kind: "system"; path: string }
  /** The selectors a system publishes whether or not a ref asks, as a JSON list; an empty one takes `publish` out. */
  | { kind: "emit"; system: string }
  | { kind: "param"; system: string; path: string }
  /** A param written once in `defaults` and shared by every system of that algorithm. */
  | { kind: "default"; algorithm: string; path: string }
  /** `role` is the role's dotted path within its section; `mode` its place in `modes`. */
  | { kind: "ref"; section: string; role: string; mode: number }
  /** A whole role, by its dotted path within its section. */
  | { kind: "role"; section: string; path: string }
  /** A group of roles or of constants, by its dotted path within `root`: a section, or `palette`. */
  | { kind: "group"; root: string; path: string }
  /**
   * A mode under `modes`, by name. Its value is `extends <mode>`, or `""` for
   * a root; a mode added as a root is added as `copy of <mode>`, and the
   * refs that make it one are set in the same step.
   */
  | { kind: "mode"; name: string }
  /** The `scheme` a mode writes; `""` when it writes none. */
  | { kind: "scheme"; mode: string }
  /** A collection of roles: a top-level key that is not one the grammar keeps. Its value is `{}`. */
  | { kind: "collection"; name: string }
  /**
   * How a key the grammar renamed is written: its earlier spelling while any
   * block still writes it, its current one otherwise. Setting the current
   * spelling rewrites every earlier one.
   */
  | { kind: "spelling"; key: RespelledKey };

export type ConstantTarget = Extract<EditTarget, { kind: "constant" }>;
export type SystemTarget = Extract<EditTarget, { kind: "system" }>;
export type RoleTarget = Extract<EditTarget, { kind: "role" }>;
export type GroupTarget = Extract<EditTarget, { kind: "group" }>;
type EmitTarget = Extract<EditTarget, { kind: "emit" }>;
export type ModeTarget = Extract<EditTarget, { kind: "mode" }>;
export type CollectionTarget = Extract<EditTarget, { kind: "collection" }>;
type SchemeTarget = Extract<EditTarget, { kind: "scheme" }>;
export type ParamTarget = Extract<EditTarget, { kind: "param" }>;
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
 * A role is added at the end of its group, renamed and moved within it, and
 * removed whole: its value is its refs, one per mode, as a JSON list.
 * Placing a constant or a role moves it to another dotted path in its
 * section or in `palette`, writing the groups on the way that are not there
 * and taking a group it leaves empty; every ref to it follows. Renaming a
 * group rewrites every ref into it. A mode is added at the end of `modes`,
 * and renamed along with every `extends` naming it; setting a mode's scheme
 * to `""` takes it out. Either writes `modes` as a map first when it is a
 * list. Adding a mode to a definition without `modes` names the one it had
 * `default` and writes each role's bare ref as a list. Removing a mode
 * takes its place out of every ref list; one another mode extends, or the
 * last mode, stays. A collection is added empty at the end of the file,
 * renamed, and removed with every role in it; refs name roles without their
 * collection, so none is rewritten. A system's own top-level param is
 * removed, and the value falls back to `defaults` or the algorithm's own.
 */
export type Edit =
  | { action: "set"; target: EditTarget; value: string }
  | { action: "add"; target: EntryTarget | ModeTarget | CollectionTarget; value: string; after?: string }
  | { action: "rename"; target: EntryTarget | GroupTarget | ModeTarget | CollectionTarget; name: string }
  | { action: "place"; target: ConstantTarget | RoleTarget; path: string }
  | { action: "move"; target: ConstantTarget | RoleTarget; after: string | null }
  | { action: "remove"; target: EntryTarget | ModeTarget | CollectionTarget | ParamTarget };

/** Where a constant or a role is after it is placed at `path`. */
export function placedTarget<Target extends ConstantTarget | RoleTarget>(target: Target, path: string): Target {
  return { ...target, path };
}

/** Where a constant, a system, a role, a group or a mode is after it is renamed. */
export function renamedTarget<Target extends EntryTarget | GroupTarget | ModeTarget | CollectionTarget>(target: Target, name: string): Target {
  if (target.kind === "mode" || target.kind === "collection") return { ...target, name };
  const renamed = (path: string) => [...path.split(".").slice(0, -1), name].join(".");
  return { ...target, path: renamed(target.path) };
}

/** Whether keys lead to a node. YAML reads `50:` as a number, and a path is text, so keys are compared as text. */
function hasPath(doc: Document, keys: string[]): boolean {
  let node: unknown = doc.contents;
  for (const key of keys) {
    if (!isMap(node)) return false;
    const pair = node.items.find((item) => isScalar(item.key) && String(item.key.value) === key);
    if (!pair) return false;
    node = pair.value;
  }
  return true;
}

/** A group's own color is written under its `$root`, at the group's path. */
function atRoot(doc: Document, keys: string[]): string[] {
  const node = doc.getIn(keys, true);
  return isMap(node) && node.has(ROOT) ? [...keys, ROOT] : keys;
}

function keysOf(target: EditTarget, doc: Document): (string | number)[] {
  switch (target.kind) {
    case "constant":
      return atRoot(doc, ["palette", ...target.path.split(".")]);
    case "system":
      return ["systems", ...target.path.split(".")];
    case "emit": {
      const system = ["systems", ...target.system.split(".")];
      return [...system, doc.hasIn([...system, "emit"]) && !doc.hasIn([...system, "publish"]) ? "emit" : "publish"];
    }
    case "param":
      return ["systems", ...target.system.split("."), "params", ...target.path.split(".")];
    case "default":
      return ["defaults", target.algorithm, ...target.path.split(".")];
    case "role":
      return atRoot(doc, [target.section, ...target.path.split(".")]);
    case "group":
      return [target.root, ...target.path.split(".")];
    case "ref": {
      const role = atRoot(doc, [target.section, ...target.role.split(".")]);
      const written = doc.getIn(role, true);
      // A role is a ref list, a block holding one under `refs`, or — in a
      // definition without modes — the ref itself.
      if (isMap(written)) return [...role, "refs", target.mode];
      return isSeq(written) ? [...role, target.mode] : role;
    }
    case "mode":
      return ["modes", target.name];
    case "scheme":
      return ["modes", target.mode, "scheme"];
    case "collection":
      return [target.name];
    case "spelling":
      return [];
  }
}

export function describeTarget(target: EditTarget): string {
  switch (target.kind) {
    case "constant":
    case "system":
      return target.path;
    case "emit":
      return `${target.system} publish`;
    case "param":
      return `${target.system} ${target.path}`;
    case "default":
      return `defaults ${target.algorithm} ${target.path}`;
    case "ref":
      return `${target.role}, mode ${target.mode + 1}`;
    case "role":
      return target.path;
    case "group":
      return `the group ${target.path}`;
    case "mode":
      return `the mode ${target.name}`;
    case "scheme":
      return `the scheme of ${target.mode}`;
    case "collection":
      return `the collection ${target.name}`;
    case "spelling":
      return `the spelling of ${target.key}`;
  }
}

/**
 * Keys the grammar renamed whose earlier spelling it still reads, and the
 * blocks each can be written on. The editor offers to write the current one.
 */
const RESPELLINGS = {
  publish: {
    earlier: "emit",
    blocks: (doc: Document): YAMLMap[] => [
      ...mapsUnder(doc.get("palette", true), () => true),
      ...mapsUnder(doc.get("systems", true), (map) => map.has("algorithm")),
    ],
  },
} satisfies Record<string, { earlier: string; blocks: (doc: Document) => YAMLMap[] }>;

export type RespelledKey = keyof typeof RESPELLINGS;
export const RESPELLED_KEYS = Object.keys(RESPELLINGS) as RespelledKey[];
export const earlierSpelling = (key: RespelledKey): string => RESPELLINGS[key].earlier;

function mapsUnder(node: unknown, keep: (map: YAMLMap) => boolean): YAMLMap[] {
  if (!isMap(node)) return [];
  return node.items.flatMap((item) => (isMap(item.value) ? [...(keep(item.value) ? [item.value] : []), ...mapsUnder(item.value, keep)] : []));
}

/** The keys written in the earlier spelling, on blocks that do not also write the current one. */
function earlierSpellings(doc: Document, key: RespelledKey): Located[] {
  const { earlier, blocks } = RESPELLINGS[key];
  return blocks(doc)
    .filter((block) => !block.has(key))
    .flatMap((block) => block.items.filter((item) => isScalar(item.key) && item.key.value === earlier && item.key.range).map((item) => item.key as Located));
}

function withRespelled(text: string, key: RespelledKey, value: string): string {
  if (value !== key) throw new Error(`${key} is written as ${key}; ${RESPELLINGS[key].earlier} is only read`);
  return earlierSpellings(parseDocument(text), key)
    .sort((a, b) => b.range[0] - a.range[0])
    .reduce((written, at) => written.slice(0, at.range[0]) + key + written.slice(at.range[1]), text);
}

/** Unquoted, `#` starts a comment and flow punctuation ends the value; this is what can go without quotes. */
function plainSafe(value: string): boolean {
  return /^[A-Za-z][\w().%/= -]*$/.test(value) && !value.endsWith(" ");
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
      text =
        edit.target.kind === "mode"
          ? withModeRenamed(text, edit.target, edit.name)
          : edit.target.kind === "collection"
            ? withCollectionRenamed(text, edit.target, edit.name)
            : withEntryRenamed(text, edit.target, edit.name);
      continue;
    }
    if (edit.action === "place") {
      text = withEntryPlaced(text, edit.target, edit.path);
      continue;
    }
    if (edit.action === "move") {
      text = withEntryMoved(text, edit.target, edit.after);
      continue;
    }
    if (edit.action === "remove") {
      text = edit.target.kind === "mode"
        ? withModeRemoved(text, edit.target)
        : edit.target.kind === "collection"
        ? withCollectionRemoved(text, edit.target)
        : edit.target.kind === "param"
        ? withParamRemoved(text, edit.target)
        : edit.target.kind === "system" ? withEntryRemoved(text, edit.target) : withGroupedRemoved(text, edit.target);
      continue;
    }
    if (edit.action === "add") {
      text =
        edit.target.kind === "mode"
          ? withModeAdded(text, edit.target, edit.value)
          : edit.target.kind === "collection"
          ? withCollectionAdded(text, edit.target)
          : edit.target.kind === "system"
          ? withSystemAdded(text, edit.target, edit.value)
          : edit.target.kind === "role"
            ? withRoleAdded(text, edit.target, edit.value, edit.after)
            : withConstantAdded(text, edit.target, edit.value, edit.after);
      continue;
    }
    if (edit.target.kind === "role" || edit.target.kind === "group") {
      throw new Error(`${describeTarget(edit.target)} is edited one ref at a time`);
    }
    if (edit.target.kind === "mode" || edit.target.kind === "collection") throw new Error(`${describeTarget(edit.target)} is added and renamed, not set`);
    if (edit.target.kind === "spelling") {
      text = withRespelled(text, edit.target.key, edit.value);
      continue;
    }
    if (edit.target.kind === "scheme") {
      text = withSchemeSet(text, edit.target, edit.value);
      continue;
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
    // A param can change shape, a number becoming a list or a list a number, as a value per end does.
    const structured = structureSource(edit.value);
    const structure = structureAt(text, edit.target, structured != null);
    if (structure) {
      text = text.slice(0, structure.start) + (structured ?? plainSource(edit.value)) + text.slice(structure.end);
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
  if (target.kind === "group") return isGroup(writtenAt(yamlText, target)) ? "{}" : null;
  if (target.kind === "mode" || target.kind === "scheme") return modeValue(yamlText, target);
  if (target.kind === "collection") return collectionPair(parseDocument(yamlText), target.name) ? "{}" : null;
  if (target.kind === "spelling") return earlierSpellings(parseDocument(yamlText), target.key).length > 0 ? RESPELLINGS[target.key].earlier : target.key;
  if (structureAt(yamlText, target, false)) return JSON.stringify((writtenAt(yamlText, target) as YAMLMap | YAMLSeq).toJSON());
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
/**
 * The span of a param's written list or map, which a value is written over
 * whole; with `orScalar`, a written scalar's too, for a list or map to
 * replace.
 */
function structureAt(yamlText: string, target: EditTarget, orScalar: boolean): { start: number; end: number } | null {
  if (target.kind !== "param" && target.kind !== "default") return null;
  const node = writtenAt(yamlText, target);
  if (orScalar && isScalar(node) && node.range && node.value != null) return { start: node.range[0], end: node.range[1] };
  if (!(isSeq(node) || isMap(node)) || !node.range) return null;
  return { start: node.range[0], end: node.flow ? node.range[1] : lastWrittenEnd(node) };
}

/** A scalar written where a list or map was: a number bare, a plain word bare, anything else quoted. */
function plainSource(value: string): string {
  return /^-?\d+(\.\d+)?$/.test(value) || plainSafe(value) ? value : JSON.stringify(value);
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

/**
 * A new constant at the end of its group, or of `palette` for one in no
 * group. A group `palette` does not have yet is written with it, at the end.
 */
function withConstantAdded(text: string, target: ConstantTarget, value: string, after?: string): string {
  return withEntryAddedDeep(text, ["palette", ...target.path.split(".")], JSON.stringify(value), target, "and is not a color", after);
}

/**
 * A new entry at a dotted path, in the map that path names. The groups on
 * the way that the file does not have are written with it, at the end of the
 * deepest one it has; the map the path starts in has to be there.
 */
function withEntryAddedDeep(text: string, keys: string[], source: string, target: EditTarget, alreadyWritten: string, after?: string): string {
  const doc = parseDocument(text);
  let held = keys.length - 1;
  while (held > 1 && doc.getIn(keys.slice(0, held), true) == null) held -= 1;
  const holder = doc.getIn(keys.slice(0, held), true);
  if (isMap(holder) && holder.has("refs")) {
    throw new Error(`${keys.slice(1, held).join(".")} is a role, not a group for ${describeTarget(target)} to go in`);
  }
  const name = keys.at(-1)!;
  const missing = keys.slice(held, -1);
  if (missing.length === 0) return withEntryAdded(text, keys.slice(0, -1), name, source, target, alreadyWritten, after);
  const entry = `${keySource(name)}: ${source}`;
  const [first, ...deeper] = missing;
  const block = deeper.reduceRight<string[]>((lines, key) => [`${keySource(key)}:`, ...lines.map((line) => `  ${line}`)], [entry]);
  const flow = deeper.reduceRight((inner, key) => `{ ${keySource(key)}: ${inner} }`, `{ ${entry} }`);
  return withEntryAdded(text, keys.slice(0, held), first, flow, target, alreadyWritten, undefined, block);
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
    return withEntryAdded(text, keysOf(target, parseDocument(text)).slice(0, -1) as string[], "publish", structureSource(value)!, target, "but not as a list");
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
function withRoleAdded(text: string, target: RoleTarget, value: string, after?: string): string {
  const keys = [target.section, ...target.path.split(".")];
  const refs = JSON.parse(value) as string[];
  const written = refs.map((ref) => (ref === INHERIT || plainSafe(ref) ? ref : JSON.stringify(ref)));
  const source = parseDocument(text).has("modes") ? `[${written.join(", ")}]` : written[0];
  return withEntryAddedDeep(text, keys, source, target, "as a role or a group", after);
}

/** A map of roles or of constants, as against a role written as a block. */
function isGroup(node: unknown): node is YAMLMap {
  return isMap(node) && !node.has("refs");
}

/**
 * The entry at another dotted path, with every ref to it rewritten. Its value
 * goes as it is written when that is on one line, and as a flow value
 * otherwise; it lands at the end of the group it joins.
 */
function withEntryPlaced(text: string, target: ConstantTarget | RoleTarget, path: string): string {
  const placed = placedTarget(target, path);
  const pointed = withPointersRewritten(text, [], target.kind, target.path, path);
  const value = entryAt(pointed, target).pair.value as Node;
  const onOneLine = isScalar(value) || ((isMap(value) || isSeq(value)) && value.flow === true);
  const source = onOneLine ? pointed.slice(value.range![0], value.range![1]) : structureSource(JSON.stringify(value.toJSON()))!;
  const keys = keysOf(placed, parseDocument(pointed)) as string[];
  const added = withEntryAddedDeep(pointed, keys, source, placed, target.kind === "role" ? "as a role or a group" : "and is not a color");
  return withGroupedRemoved(added, target);
}

/** The text with each span written over, and every value pointing at `from` saying `to`. */
function withPointersRewritten(
  text: string,
  spans: { start: number; end: number; source: string }[],
  kind: EntryTarget["kind"],
  from: string,
  to: string,
  holds?: (path: string) => boolean,
): string {
  const rewritten = pointersAt(parseDocument(text).contents, [], kind, from, to, holds).map(({ node, renamed }) => ({
    start: node.range![0],
    end: node.range![1],
    source: sourceFor(renamed, node),
  }));
  return [...spans, ...rewritten]
    .sort((a, b) => b.start - a.start)
    .reduce((written, { start, end, source }) => written.slice(0, start) + source + written.slice(end), text);
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
function withParamRemoved(text: string, target: ParamTarget): string {
  if (target.path.includes(".")) throw new Error(`${describeTarget(target)} is part of a param; a param is removed whole`);
  const doc = parseDocument(text);
  const keys = ["systems", ...target.system.split("."), "params", target.path];
  const set = doc.getIn(keys.slice(0, -1), true);
  const pair = isMap(set) ? set.items.find((item) => isScalar(item.key) && item.key.value === target.path) : undefined;
  if (!isMap(set) || !pair || !isScalar(pair.key) || !pair.key.range) {
    throw new Error(`nothing written for ${describeTarget(target)} to remove`);
  }
  return withEntryRemoved(text, target, { doc, keys, set, pair: pair as Entry["pair"] }, false);
}

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
  // A file that has nothing of the kind yet gets the block for it, as the first entry is added.
  if (mapKeys.length === 1 && !parseDocument(text).has(mapKeys[0])) text = withBlockAppended(text, mapKeys[0]);
  const set = parseDocument(text).getIn(mapKeys, true);
  if (!isMap(set) || !set.range) {
    throw new Error(`nothing written for ${describeTarget(target)} to be added to`);
  }
  if (set.items.some((item) => isScalar(item.key) && item.key.value === name)) {
    throw new Error(`${describeTarget(target)} is already written, ${alreadyWritten}`);
  }
  const entry = `${keySource(name)}: ${valueSource}`;
  // A collection is added as `{}`; its first role makes it a block, the way collections are written.
  const holding = mapKeys.length === 1 && set.flow && set.items.length === 0 ? (parseDocument(text).contents as YAMLMap).items.find((item) => isScalar(item.key) && item.key.value === mapKeys[0]) : undefined;
  if (holding && isScalar(holding.key) && holding.key.range) {
    const lines = valueBlock ? [`${keySource(name)}:`, ...valueBlock.map((line) => `  ${line}`)] : [entry];
    return `${text.slice(0, holding.key.range[1])}:${lines.map((line) => `\n  ${line}`).join("")}${text.slice(set.range[1])}`;
  }
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

/** The constant, system, role, group or publish list a target names, with the map it is in. Throws when the file has no such entry. */
function entryAt(text: string, target: EntryTarget | EmitTarget | GroupTarget): Entry {
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
          : target.kind === "group"
            ? isGroup(pair?.value)
            : isScalar(pair?.value);
  if (!isMap(set) || !pair || !written || !isScalar(pair.key) || !pair.key.range) {
    throw new Error(`nothing written for ${describeTarget(target)} to edit`);
  }
  return { doc, keys, set, pair: pair as Entry["pair"] };
}

function withEntryRenamed(text: string, target: EntryTarget | GroupTarget, name: string): string {
  const { doc, keys, set, pair } = entryAt(text, target);
  if (target.kind !== "group" && keys.at(-1) === ROOT) {
    throw new Error(`${describeTarget(target)} is its group's own color, renamed with the group`);
  }
  if (set.items.some((item) => isScalar(item.key) && item.key.value === name)) {
    throw new Error(`${describeTarget(renamedTarget(target, name))} is already written`);
  }
  const kind = target.kind === "group" ? (target.root === "palette" ? "constant" : "role") : target.kind;
  return withPointersRewritten(
    text,
    [{ start: pair.key.range[0], end: pair.key.range[1], source: keySource(name) }],
    kind,
    target.path,
    renamedTarget(target, name).path,
    target.kind === "group" ? (path) => hasPath(doc, [target.root, ...path.split(".")]) : undefined,
  );
}

/**
 * Every value that points at the constant `from`, with what it says once the
 * constant is `to`: a role's ref, `transparent(from …)`, or a color param.
 * For a system, every ref into it, `from(…)`, plain or inside
 * `transparent(…)`; for a role, every other role's ref to it, likewise. Only where refs and params are
 * written — an `alias` or a changelog note that happens to read the same is
 * left alone. With `holds`, `from` is a group, and every value pointing at
 * something it holds is one: a path that only starts the same, into a group
 * of another kind with the group's name, is not.
 */
function pointersAt(
  node: unknown,
  keys: string[],
  kind: EntryTarget["kind"],
  from: string,
  to: string,
  holds?: (path: string) => boolean,
): { node: Scalar; renamed: string }[] {
  if (isMap(node)) {
    return node.items.flatMap((pair) => {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      return pointersAt(pair.value, [...keys, key], kind, from, to, holds);
    });
  }
  if (isSeq(node)) return node.items.flatMap((item) => pointersAt(item, keys, kind, from, to, holds));
  if (!isScalar(node) || typeof node.value !== "string" || !node.range) return [];
  const [top] = keys;
  if (keys.includes("alias") || ["dtg", "modes", "changelog"].includes(top)) return [];
  // In the palette only a gradient points at anything, and only at the palette's colors.
  if (top === "palette" && !(kind === "constant" && node.value.startsWith("gradient("))) return [];
  if (kind !== "constant" && (top === "systems" || top === "defaults")) return [];
  if (top === "systems" && !keys.includes("params")) return [];
  // A group's own color is pointed at by the group's path, so a ref that is the group itself moves with it.
  const moved = (name: string) =>
    holds
      ? (name.startsWith(`${from}.`) && holds(name)) || (name === from && holds(`${from}.${ROOT}`))
        ? to + name.slice(from.length)
        : null
      : name === from
        ? to
        : null;
  const renamedRef = (ref: string): string | null => {
    const gradient = /^gradient\((.*)\)$/s.exec(ref);
    if (gradient) {
      const parts = partsOutsideParens(gradient[1]);
      const renamedParts = parts.map((part) => renamedRef(part));
      if (renamedParts.every((part) => part == null)) return null;
      return `gradient(${parts.map((part, i) => renamedParts[i] ?? part).join("")})`;
    }
    const faded = /^(transparent\(\s*)(.+?)(\s+\S+\s*\))$/.exec(ref);
    if (faded) {
      const inside = renamedRef(faded[2]);
      return inside == null ? null : faded[1] + inside + faded[3];
    }
    if (kind === "system") return ref.startsWith(`${from}(`) ? to + ref.slice(from.length) : null;
    return moved(ref);
  };
  const renamed = renamedRef(node.value);
  return renamed == null ? [] : [{ node, renamed }];
}

/** A `gradient(…)`'s inside as its words and the spaces between them, in order, so joining them gives it back. */
function partsOutsideParens(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    const space = /\s/.test(char) && depth === 0;
    const last = parts.at(-1);
    if (last != null && /^\s+$/.test(last) === space) parts[parts.length - 1] = last + char;
    else parts.push(char);
  }
  return parts;
}

/** What a group says about itself, beside the entries it holds. */
const GROUP_KEYS = { role: ["alias", "virtual", "description"], constant: ["alias", "virtual", "publish", "emit", "description"] };

/**
 * The group's entries in a new order. Each entry's own text moves, a block
 * entry with the comment on its line; whatever is written between entries
 * stays where it is.
 */
function withEntryMoved(text: string, target: ConstantTarget | RoleTarget, after: string | null): string {
  const { set, pair } = entryAt(text, target);
  const items: Pair[] = set.items;
  const others = items.filter((item) => item !== pair);
  // What a group says about itself is written before its entries, and the first entry goes after it.
  const aboutGroup = (item: Pair) => isScalar(item.key) && GROUP_KEYS[target.kind].includes(String(item.key.value));
  const first = others.findIndex((item) => !aboutGroup(item));
  const at = after == null ? (first === -1 ? others.length : first) : others.findIndex((item) => isScalar(item.key) && item.key.value === after) + 1;
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
 * A group of roles or of constants is there while it holds one: removing its
 * last takes the group with it, whatever it says about itself, and so on up
 * to the section or to `palette`, which stays.
 */
function withGroupedRemoved(text: string, target: RoleTarget | ConstantTarget): string {
  const entry = entryAt(text, target);
  let { keys, set, pair } = entry;
  const aboutGroup = GROUP_KEYS[target.kind];
  const holdsOnlyThis = () => set.items.every((item) => item === pair || (isScalar(item.key) && aboutGroup.includes(String(item.key.value))));
  while (keys.length > 2 && holdsOnlyThis()) {
    keys = keys.slice(0, -1);
    const holder = entry.doc.getIn(keys.slice(0, -1), true) as YAMLMap;
    pair = holder.items.find((item) => item.value === set) as Entry["pair"];
    set = holder;
  }
  return withEntryRemoved(text, target, { doc: entry.doc, keys, set, pair }, keys.length < entry.keys.length);
}

/**
 * The entry and its lines go. A map left with nothing is written as `{}`,
 * so it stays a map to add to rather than becoming an empty value.
 */
function withEntryRemoved(
  text: string,
  target: EntryTarget | EmitTarget | SchemeTarget | CollectionTarget | ParamTarget,
  { doc, keys, set, pair }: Entry = entryAt(text, target as EntryTarget | EmitTarget),
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

/** The mode a mode extends as `extends <mode>`, or the scheme it writes; `""` for none, null when there is no such mode. */
function modeValue(text: string, target: ModeTarget | SchemeTarget): string | null {
  const modes = parseDocument(text).get("modes", true);
  const name = target.kind === "mode" ? target.name : target.mode;
  if (isSeq(modes)) return modes.items.some((item) => isScalar(item) && String(item.value) === name) ? "" : null;
  if (!isMap(modes)) return null;
  const pair = modes.items.find((item) => isScalar(item.key) && String(item.key.value) === name);
  if (!pair) return null;
  const written = isMap(pair.value) ? pair.value.get(target.kind === "mode" ? "extends" : "scheme") : null;
  if (written == null) return "";
  return target.kind === "mode" ? `extends ${written}` : String(written);
}

/** Every role's ref list, in each section: a list written as the role, or under its `refs`. */
function refLists(doc: Document): YAMLSeq[] {
  const lists: YAMLSeq[] = [];
  const walk = (node: unknown) => {
    if (!isMap(node)) return;
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      if (["alias", "virtual", "description"].includes(key)) continue;
      const value = pair.value;
      if (isSeq(value)) lists.push(value);
      else if (isMap(value) && value.has("refs")) {
        const refs = value.get("refs", true);
        if (isSeq(refs)) lists.push(refs);
      } else walk(value);
    }
  };
  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      if (isScalar(pair.key) && !TOP_LEVEL_RESERVED.includes(String(pair.key.value))) walk(pair.value);
    }
  }
  return lists;
}

/** The span an item of a list takes, with the separator or line that goes with it. */
function itemSpan(text: string, list: YAMLSeq, index: number): { start: number; end: number } {
  const item = list.items[index] as Node;
  if (list.flow) {
    if (list.items.length === 1) return { start: item.range![0], end: item.range![1] };
    if (index === 0) return { start: item.range![0], end: (list.items[1] as Node).range![0] };
    return { start: writtenEnd(list.items[index - 1] as Node), end: item.range![1] };
  }
  const lineStart = text.lastIndexOf("\n", item.range![0]) + 1;
  return { start: lineStart, end: Math.min(lineEndAfter(text, writtenEnd(item)) + 1, text.length) };
}

function withModeRemoved(text: string, target: ModeTarget): string {
  const doc = parseDocument(text);
  const modes = doc.get("modes", true);
  const names = isSeq(modes) ? modes.items.map((item) => String((item as Scalar).value)) : isMap(modes) ? modes.items.map((item) => String((item.key as Scalar).value)) : [];
  const at = names.indexOf(target.name);
  if (at === -1) throw new Error(`nothing written for ${describeTarget(target)} to edit`);
  if (names.length === 1) throw new Error(`${describeTarget(target)} is the only mode`);
  const children = isMap(modes) ? modes.items.filter((item) => isMap(item.value) && String(item.value.get("extends")) === target.name) : [];
  if (children.length > 0) {
    throw new Error(`${describeTarget(target)} is extended by ${children.map((item) => String((item.key as Scalar).value)).join(", ")}`);
  }
  const spans = refLists(doc)
    .filter((list) => list.items.length > at)
    .map((list) => itemSpan(text, list, at));
  if (isSeq(modes)) spans.push(itemSpan(text, modes, at));
  else {
    const map = modes as YAMLMap;
    const pair = map.items[at];
    const key = pair.key as Node;
    const end = (item: Pair) => writtenEnd((item.value ?? item.key) as Node);
    if (map.flow) {
      spans.push(at === 0 ? { start: key.range![0], end: (map.items[1].key as Node).range![0] } : { start: end(map.items[at - 1]), end: end(pair) });
    } else {
      spans.push({ start: text.lastIndexOf("\n", key.range![0]) + 1, end: Math.min(lineEndAfter(text, end(pair)) + 1, text.length) });
    }
  }
  return spans.sort((a, b) => b.start - a.start).reduce((written, { start, end }) => written.slice(0, start) + written.slice(end), text);
}

/** The implicit mode of a definition without `modes`. */
const IMPLICIT_MODE = "default";

/**
 * A definition without `modes` given one, naming its implicit mode, with
 * every role's bare ref written as a list of one: with `modes` written, a
 * role holds a ref per mode.
 */
function withModesWritten(text: string): string {
  const doc = parseDocument(text);
  if (doc.has("modes") || !isMap(doc.contents)) return text;
  const bare: Located[] = [];
  const walk = (node: unknown) => {
    if (!isMap(node)) return;
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      if (["alias", "virtual", "description"].includes(key)) continue;
      const value = pair.value;
      if (isScalar(value) && typeof value.value === "string" && value.range) bare.push(value as Located);
      else if (isMap(value) && value.has("refs")) {
        const refs = value.get("refs", true);
        if (isScalar(refs) && refs.range) bare.push(refs as Located);
      } else walk(value);
    }
  };
  for (const pair of doc.contents.items) {
    if (isScalar(pair.key) && !TOP_LEVEL_RESERVED.includes(String(pair.key.value))) walk(pair.value);
  }
  let written = bare
    .sort((a, b) => b.range[0] - a.range[0])
    .reduce((at, ref) => `${at.slice(0, ref.range[0])}[${at.slice(ref.range[0], ref.range[1])}]${at.slice(ref.range[1])}`, text);
  const version = parseDocument(written).contents as YAMLMap;
  const first = version.items.find((item) => isScalar(item.key) && item.key.value === "dtg");
  const at = first ? lineEndAfter(written, writtenEnd(first.value as Node)) + 1 : 0;
  written = `${written.slice(0, at)}modes:\n  ${IMPLICIT_MODE}:\n${written.slice(at)}`;
  return written;
}

function withModesAsMap(text: string): string {
  const doc = parseDocument(text);
  const modes = doc.get("modes", true);
  if (!isSeq(modes)) return text;
  const holding = (doc.contents as YAMLMap).items.find((item) => item.value === modes)!;
  const key = holding.key as Node;
  const lineStart = text.lastIndexOf("\n", key.range![0]) + 1;
  const indent = text.slice(lineStart, key.range![0]);
  const names = modes.items.map((item) => keySource(String((item as Scalar).value)));
  return `${text.slice(0, key.range![1])}:${names.map((name) => `\n${indent}  ${name}:`).join("")}${text.slice(writtenEnd(modes))}`;
}

function modePair(doc: Document, name: string, target: EditTarget): Pair<Scalar & { range: NonNullable<Scalar["range"]> }, Node | null> {
  const modes = doc.get("modes", true);
  const pair = isMap(modes) ? modes.items.find((item) => isScalar(item.key) && String(item.key.value) === name) : undefined;
  if (!pair || !isScalar(pair.key) || !pair.key.range) throw new Error(`nothing written for ${describeTarget(target)} to edit`);
  return pair as Pair<Scalar & { range: NonNullable<Scalar["range"]> }, Node | null>;
}

function withModeAdded(text: string, target: ModeTarget, value: string): string {
  const from = /^(extends|copy of) (.+)$/.exec(value);
  if (!from) throw new Error(`${describeTarget(target)} is added as \`extends <mode>\` or \`copy of <mode>\`, not ${JSON.stringify(value)}`);
  const mapped = withModesAsMap(withModesWritten(text));
  const source = from[2];
  modePair(parseDocument(mapped), source, { kind: "mode", name: source });
  if (from[1] === "copy of") return withEntryAdded(mapped, ["modes"], target.name, "{}", target, "as a mode", undefined, []);
  return withEntryAdded(mapped, ["modes"], target.name, `{ extends: ${keySource(source)} }`, target, "as a mode", undefined, [`extends: ${keySource(source)}`]);
}

function withModeRenamed(text: string, target: ModeTarget, name: string): string {
  const doc = parseDocument(text);
  const modes = doc.get("modes", true);
  if (modeValue(text, { kind: "mode", name }) != null) throw new Error(`${describeTarget({ kind: "mode", name })} is already written`);
  const splices: { start: number; end: number; source: string }[] = [];
  if (isSeq(modes)) {
    const item = modes.items.find((candidate) => isScalar(candidate) && String(candidate.value) === target.name) as Scalar | undefined;
    if (!item?.range) throw new Error(`nothing written for ${describeTarget(target)} to edit`);
    splices.push({ start: item.range[0], end: item.range[1], source: keySource(name) });
  } else {
    const pair = modePair(doc, target.name, target);
    splices.push({ start: pair.key.range[0], end: pair.key.range[1], source: keySource(name) });
    for (const other of (modes as YAMLMap).items) {
      const parent = isMap(other.value) ? other.value.get("extends", true) : null;
      if (isScalar(parent) && parent.range && String(parent.value) === target.name) {
        splices.push({ start: parent.range[0], end: parent.range[1], source: sourceFor(name, parent) });
      }
    }
  }
  return splices
    .sort((a, b) => b.start - a.start)
    .reduce((written, { start, end, source }) => written.slice(0, start) + source + written.slice(end), text);
}

function withSchemeSet(text: string, target: SchemeTarget, scheme: string): string {
  const mapped = withModesAsMap(text);
  const doc = parseDocument(mapped);
  const pair = modePair(doc, target.mode, target);
  const block = pair.value;
  if (isMap(block)) {
    const written = block.items.find((item) => isScalar(item.key) && item.key.value === "scheme");
    if (written && scheme === "") {
      return withEntryRemoved(mapped, target, { doc, keys: ["modes", target.mode, "scheme"], set: block, pair: written as Entry["pair"] });
    }
    if (written && isScalar(written.value) && written.value.range) {
      const [start, end] = written.value.range;
      return mapped.slice(0, start) + scheme + mapped.slice(end);
    }
    if (scheme === "") return mapped;
    return withEntryAdded(mapped, ["modes", target.mode], "scheme", scheme, target, "");
  }
  if (scheme === "") return mapped;
  const keyEnd = pair.key.range[1];
  const valueEnd = isScalar(block) && block.range ? block.range[1] : keyEnd;
  const modes = doc.get("modes", true) as YAMLMap;
  const lineStart = mapped.lastIndexOf("\n", pair.key.range[0]) + 1;
  const indent = mapped.slice(lineStart, pair.key.range[0]);
  const source = modes.flow ? `: { scheme: ${scheme} }` : `:\n${indent}  scheme: ${scheme}`;
  const colon = mapped.indexOf(":", keyEnd);
  return mapped.slice(0, keyEnd) + source + mapped.slice(Math.max(colon + 1, valueEnd));
}

function collectionPair(doc: Document, name: string): Pair<Scalar & { range: NonNullable<Scalar["range"]> }, Node> | null {
  if (TOP_LEVEL_RESERVED.includes(name) || !isMap(doc.contents)) return null;
  const pair = doc.contents.items.find((item) => isScalar(item.key) && String(item.key.value) === name);
  if (!pair || !isMap(pair.value) || !isScalar(pair.key) || !pair.key.range) return null;
  return pair as Pair<Scalar & { range: NonNullable<Scalar["range"]> }, Node>;
}

/** Why `name` cannot be a collection's: the grammar keeps it, or the file has it. */
function collectionNameTaken(doc: Document, name: string, target: EditTarget): void {
  if (TOP_LEVEL_RESERVED.includes(name)) throw new Error(`${name} is a key the definition keeps for itself, not ${describeTarget(target)}`);
  if (isMap(doc.contents) && doc.contents.has(name)) throw new Error(`${name} is already written`);
}

/** A new collection, empty, after everything the file holds. */
function withCollectionAdded(text: string, target: CollectionTarget): string {
  collectionNameTaken(parseDocument(text), target.name, target);
  return withBlockAppended(text, target.name);
}

/** A top-level key holding an empty map, after everything the file holds, set off by a blank line. */
function withBlockAppended(text: string, key: string): string {
  const body = text.replace(/\s*$/, "");
  return `${body}${body === "" ? "" : "\n\n"}${keySource(key)}: {}\n`;
}

function withCollectionRenamed(text: string, target: CollectionTarget, name: string): string {
  const doc = parseDocument(text);
  const pair = collectionPair(doc, target.name);
  if (!pair) throw new Error(`nothing written for ${describeTarget(target)} to edit`);
  collectionNameTaken(doc, name, { kind: "collection", name });
  return text.slice(0, pair.key.range[0]) + keySource(name) + text.slice(pair.key.range[1]);
}

function withCollectionRemoved(text: string, target: CollectionTarget): string {
  const doc = parseDocument(text);
  const pair = collectionPair(doc, target.name);
  if (!pair) throw new Error(`nothing written for ${describeTarget(target)} to edit`);
  return withEntryRemoved(text, target, { doc, keys: [target.name], set: doc.contents as YAMLMap, pair: pair as Entry["pair"] }, true);
}

/** The definition with `dtg: 1` at its top when it does not say which grammar it is written in. */
export function withGrammarVersion(text: string): string {
  if (parseDocument(text).has("dtg")) return text;
  return text.trim() === "" ? "dtg: 1\n" : `dtg: 1\n\n${text}`;
}
