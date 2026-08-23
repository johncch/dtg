// A dot per test, then one summary line. The built-in `dot` reporter prints
// no summary at all, and `spec` prints forty lines to say nothing failed.
const C = process.env.NO_COLOR
  ? { g: "", r: "", d: "", x: "" }
  : { g: "\x1b[32m", r: "\x1b[31m", d: "\x1b[2m", x: "\x1b[0m" };

export default async function* reporter(source) {
  const failures = [];
  let suite = "";
  let dots = 0;

  for await (const event of source) {
    const data = event.data ?? {};
    switch (event.type) {
      case "test:start":
        if (data.nesting === 0) suite = data.name;
        break;

      case "test:pass":
        if (data.details?.type === "suite") break;
        yield `${C.g}.${C.x}`;
        if (++dots % 50 === 0) yield "\n";
        break;

      case "test:fail":
        if (data.details?.type === "suite") break;
        yield `${C.r}✖${C.x}`;
        if (++dots % 50 === 0) yield "\n";
        failures.push({ suite, name: data.name, error: data.details?.error });
        break;

      // The run-level summary is the one that names no file.
      case "test:summary": {
        if (data.file) break;
        const { passed, failed, skipped, todo } = data.counts;
        yield "\n";
        for (const f of failures) {
          const where = f.suite ? `${f.suite} › ${f.name}` : f.name;
          yield `\n${C.r}✖ ${where}${C.x}\n`;
          const message = String(f.error?.cause?.message ?? f.error?.message ?? "")
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n");
          yield `${message}\n`;
          // The assertion is wrapped: the runner's own error carries the
          // real one on `cause`, and only that stack names the test file.
          const stacks = [f.error?.cause?.stack, f.error?.stack];
          const at = stacks
            .flatMap((s) => String(s ?? "").split("\n"))
            .find((l) => l.includes("test/") && l.includes(".test."));
          if (at) yield `${C.d}  ${at.trim().replace(/^at /, "")}${C.x}\n`;
        }
        const bits = [`${passed} passed`];
        if (failed) bits.push(`${C.r}${failed} failed${C.x}`);
        if (skipped) bits.push(`${skipped} skipped`);
        if (todo) bits.push(`${todo} todo`);
        const mark = failed ? `${C.r}✖${C.x}` : `${C.g}✔${C.x}`;
        yield `\n${mark} ${bits.join("  ")} ${C.d}in ${Math.round(data.duration_ms)}ms${C.x}\n`;
        break;
      }
    }
  }
}
