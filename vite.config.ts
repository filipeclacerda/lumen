/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        /src-tauri/,
        /\\src-tauri\\/,
        "**/src-tauri/**",
        "**/.claude/**",
        "**/.git/**",
        "**/target/**",
        "**/dist/**",
        "**/*.tsbuildinfo"
      ],
      usePolling: true
    }
  },
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/worktrees/**"]
  }
});
