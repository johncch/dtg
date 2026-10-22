// Copies the example definitions into dist/examples for `dtg init --example`,
// dropping the "run it from the repo" line that would be wrong in a project.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("dist/examples", { recursive: true });
for (const file of readdirSync("examples").filter((f) => f.endsWith(".dtg.yaml"))) {
  const text = readFileSync(`examples/${file}`, "utf8").replace(
    /^#\n#\s+npx dtg dev --definition examples\/[^\n]*\n/m,
    "",
  );
  writeFileSync(`dist/examples/${file}`, text);
}
