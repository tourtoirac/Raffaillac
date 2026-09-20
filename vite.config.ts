import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "/",
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
  },
});