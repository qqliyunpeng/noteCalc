import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

// Desktop-only target: the dev server keeps a fixed port so `tauri dev` can
// point at it deterministically.
export default defineConfig({
  plugins: [react()],
  // 「关于」对话框里的版本号取自 package.json，避免两处各写一份而漂移。
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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