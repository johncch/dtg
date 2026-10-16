/**
 * How the app is being run: by `dtg dev`, which answers every page address
 * with this document and serves the API, or as files from `dtg docs`, which
 * any static host can serve from any folder.
 */
export type AppMode = "served" | "static";

/**
 * The app's only HTML; the bundle reads the address and draws the page. A
 * static copy points at its files relatively, so it works under any folder,
 * and says it is static so the app reads its snapshot from a file and offers
 * no editing.
 */
export function appShell(title: string, mode: AppMode): string {
  const ui = mode === "static" ? "ui/" : "/ui/";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="dtg-mode" content="${mode}">
<title>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>
<link rel="icon" type="image/png" href="${ui}favicon.png">
<link rel="stylesheet" href="${ui}dtg-ui.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="${ui}dtg-ui.js"></script>
</body>
</html>`;
}
