import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["dist/**", "src-tauri/**", "node_modules/**", ".agents/**", ".claude/**", ".codex/**", ".opencode/**", "*.d.ts"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Existing UI boundaries receive errors from external APIs and Tauri plugins.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  reactHooks.configs["recommended-latest"],
);
