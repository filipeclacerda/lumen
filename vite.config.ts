import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: (path: string) => {
        const normalized = path.replace(/\\/g, "/");
        return normalized.indexOf("/src-tauri/target/") !== -1;
      }
    }
  },
  envPrefix: ["VITE_", "TAURI_"]
});
