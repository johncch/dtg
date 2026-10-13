import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The dev server serves the bundle's files flat under /ui/.
  base: "/ui/",
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: "ui/main.tsx",
      output: {
        entryFileNames: "dtg-ui.js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "dtg-ui[extname]",
      },
    },
  },
});
