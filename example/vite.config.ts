import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Map .js imports (used in the library source) to actual .ts files
      "../parse-context.js": path.resolve(__dirname, "../src/parse-context.ts"),
      "./parse-context.js": path.resolve(__dirname, "../src/parse-context.ts"),
      "../binxml.js": path.resolve(__dirname, "../src/binxml.ts"),
      "./binxml.js": path.resolve(__dirname, "../src/binxml.ts"),
    },
  },
  define: {
    "process.env.EVTX_DEBUG": JSON.stringify(""),
  },
});
