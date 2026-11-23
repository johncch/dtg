import type { ResolvedColorRef, ResolvedGradientRef } from "./resolve.js";

/** What a ref can resolve to, by the name a declaration uses for it. */
export type RefKinds = { color: ResolvedColorRef; gradient: ResolvedGradientRef };
export type RefKind = keyof RefKinds;

type Declaration = {
  /** Finishes "that name is taken by name(), …" when a system asks for the name. */
  is: string;
  /** What its ref arguments may resolve to. */
  accepts: readonly RefKind[];
  /** Its named arguments, written `name=value` after the positional ones. Every other argument is positional. */
  named: readonly string[];
  /** A call written out, for an error to end on. */
  usage: string;
};

/**
 * The functions a ref can call, each declared once. The resolver checks a
 * call against its declaration, and the kinds an implementation is handed
 * are inferred from the same line, so one cannot drift from the other.
 */
export const REF_FUNCTIONS = {
  transparent: {
    is: "the ref that takes a color or a gradient at an opacity",
    accepts: ["color", "gradient"],
    named: [],
    usage: "transparent(shade 70)",
  },
  gradient: {
    is: "the ref that lays colors along a line, out from a point or around one",
    accepts: ["color", "gradient"],
    named: ["kind", "angle", "x", "y", "shape", "size", "repeat", "space"],
    usage: "gradient(paper shade angle=90deg)",
  },
} as const satisfies Record<string, Declaration>;

export type RefFunction = keyof typeof REF_FUNCTIONS;

/** A ref as the function `F` may be handed it. */
export type Accepted<F extends RefFunction> = RefKinds[(typeof REF_FUNCTIONS)[F]["accepts"][number]];

export function isRefFunction(name: string): name is RefFunction {
  return Object.hasOwn(REF_FUNCTIONS, name);
}

export function accepts<F extends RefFunction>(fn: F, ref: RefKinds[RefKind]): ref is Accepted<F> {
  return (REF_FUNCTIONS[fn].accepts as readonly RefKind[]).includes(ref.kind);
}

/** "a color", "a color or a gradient": what `fn` accepts, as an error says it. */
export function acceptedBy(fn: RefFunction): string {
  return REF_FUNCTIONS[fn].accepts.map((kind) => `a ${kind}`).join(" or ");
}

/**
 * A call's words as positional arguments, then named ones. Named arguments
 * come last, each one the function declares and each once; anything else is
 * the error returned.
 */
export function splitArguments(
  fn: RefFunction,
  words: string[],
): { positional: string[]; named: Map<string, string> } | { error: string } {
  const { named: declared, usage } = REF_FUNCTIONS[fn];
  const isNamed = (word: string) => /^[a-z][a-z0-9-]*=/.test(word);
  const firstNamed = words.findIndex(isNamed);
  const positional = firstNamed === -1 ? words : words.slice(0, firstNamed);
  const named = new Map<string, string>();
  for (const word of firstNamed === -1 ? [] : words.slice(firstNamed)) {
    if (!isNamed(word)) {
      return { error: `${fn}() got ${word} after a named argument — positional arguments come first and named ones last, as ${usage}` };
    }
    const name = word.slice(0, word.indexOf("="));
    if (!(declared as readonly string[]).includes(name)) {
      return { error: `${fn}() has no argument named ${name}${declared.length > 0 ? ` — it takes ${declared.join(", ")}` : ""}` };
    }
    if (named.has(name)) return { error: `${fn}() got ${name} twice` };
    named.set(name, word.slice(name.length + 1));
  }
  return { positional, named };
}

/** A call's words: split on spaces, except inside a ref's own parentheses. */
export function wordsOutsideParens(text: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let word = "";
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (/\s/.test(char) && depth === 0) {
      if (word) words.push(word);
      word = "";
    } else {
      word += char;
    }
  }
  if (word) words.push(word);
  return words;
}

/** A `gradient(…)` as it is written: each stop's ref and position as text, and its named arguments. Nothing is resolved. */
export type WrittenGradient = { stops: { ref: string; position: string | null }[]; named: Map<string, string> };

/** Takes a `gradient(…)` apart for an editor to change one piece of; null when the text does not read as one. */
export function readGradient(text: string): WrittenGradient | null {
  const call = /^gradient\((.*)\)$/s.exec(text.trim());
  if (!call) return null;
  const args = splitArguments("gradient", wordsOutsideParens(call[1]));
  if ("error" in args) return null;
  const stops: WrittenGradient["stops"] = [];
  for (const word of args.positional) {
    const stop = stops.at(-1);
    if (!word.endsWith("%")) stops.push({ ref: word, position: null });
    else if (stop && stop.position == null) stop.position = word;
    else return null;
  }
  return { stops, named: args.named };
}

/** The one way a gradient taken apart is written back: stops in order, then named arguments in the order the function declares them. */
export function writeGradient({ stops, named }: WrittenGradient): string {
  const words = stops.map((stop) => (stop.position == null ? stop.ref : `${stop.ref} ${stop.position}`));
  for (const name of REF_FUNCTIONS.gradient.named) {
    const value = named.get(name);
    if (value != null) words.push(`${name}=${value}`);
  }
  return `gradient(${words.join(" ")})`;
}
