import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Each page is its own HTML file so static hosts serve it without routing rewrites.
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        downloadStarted: fileURLToPath(new URL("./download/started/index.html", import.meta.url)),
      },
    },
  },
});
