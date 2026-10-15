import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Desktop-only target: the dev server keeps a fixed port so `tauri dev` can
// point at it deterministically.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
  },
});