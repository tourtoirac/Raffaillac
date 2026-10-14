import { resolve } from "node:path";
import { defineConfig } from "vite";

// Public path the build is served from: "/" by default, "/obg/" behind a
// reverse proxy that publishes the application under a sub-path.
const base = process.env.OBG_BASE ?? "/";

export default defineConfig({
  root: ".",
  base,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        game: resolve(import.meta.dirname, "game.html"),
      },
    },
  },
  server: {
    port: 5173,
    // resources shared by the OBG front ends live in OBG/Common, outside this repository
    fs: {
      allow: [".", resolve(import.meta.dirname, "../Common")],
    },
  },
});