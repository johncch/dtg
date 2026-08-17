import { watch } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * Watch the directory, not the file: editors that write via rename swap the
 * inode and a file watch goes silent after the first save.
 */
export function watchDefinition(
  definitionPath: string,
  onChange: () => void,
): void {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  watch(dirname(definitionPath), (_event, filename) => {
    if (filename !== basename(definitionPath)) return;
    clearTimeout(debounce);
    debounce = setTimeout(onChange, 100);
  });
}
