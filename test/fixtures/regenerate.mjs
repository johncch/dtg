// Rewrites the golden outputs. Run deliberately, and read the diff.
import { readFileSync, writeFileSync } from "node:fs";
import { resolveDefinition } from "../../dist/resolve.js";
import { emitCss, emitDtcg } from "../../dist/emit.js";

const here = new URL(".", import.meta.url);
const src = readFileSync(new URL("kitchen-sink.dtg.yaml", here), "utf8");
const resolved = resolveDefinition(src);
writeFileSync(new URL("kitchen-sink.plain.css", here), emitCss(resolved, "plain"));
writeFileSync(new URL("kitchen-sink.tailwind.css", here), emitCss(resolved, "tailwind"));
writeFileSync(
  new URL("kitchen-sink.tokens.json", here),
  JSON.stringify(emitDtcg(resolved), null, 2) + "\n",
);
console.log("goldens rewritten");
