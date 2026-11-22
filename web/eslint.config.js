import tsParser from "@typescript-eslint/parser";

export default [
  { ignores: ["dist/**", "node_modules/**", "src/routeTree.gen.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {},
  },
];
