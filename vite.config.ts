import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension from "vite-plugin-web-extension";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    webExtension({
      manifest: "manifest.json",
      watchFilePaths: ["manifest.json"],
      skipManifestValidation: true,
    }),
  ],
  define: {
    __BUILD_TIME__: "Date.now()",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
