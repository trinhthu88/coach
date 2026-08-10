import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  // No manual vendor chunking: forcing React into its own chunk while its
  // consumers (Radix, react-router, TanStack Query, etc.) sit in separate
  // manually-named chunks breaks Rollup's execution-order guarantees —
  // producing "Cannot read properties of undefined (reading 'createContext')"
  // at runtime because a consumer chunk can evaluate before vendor-react has.
  // Route-level splitting (React.lazy in App.tsx) and dynamic xlsx imports
  // already create their own chunks automatically and don't depend on this.
  resolve: {
    alias: [
      {
        find: /^@\/integrations\/supabase\/client$/,
        replacement: path.resolve(__dirname, "./src/lib/supabase-target.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
}));
