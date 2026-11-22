import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, "src");

export default defineConfig({
  root,
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [
    tanstackRouter({
      target: "react",
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
  ],
  resolve: { alias: { "@": src } },
  server: { host: "0.0.0.0" },
  build: { outDir: "dist", emptyOutDir: true },
});
