import type { SnapshotDefinition } from "../../src/snapshot.js";

export function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1)!;
}

export function DefinitionPage({ definition }: { definition: SnapshotDefinition }) {
  return (
    <>
      <h1>{fileName(definition.path)}</h1>
      <p className="sub">
        <code>{definition.path}</code>
      </p>
      <pre className="source">{definition.text}</pre>
    </>
  );
}
