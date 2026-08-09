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
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React core
          if (id.includes("node_modules/react/") ||
              id.includes("node_modules/react-dom/") ||
              id.includes("node_modules/scheduler/")) {
            return "vendor-react";
          }
          // Radix UI primitives
          if (id.includes("node_modules/@radix-ui/")) {
            return "vendor-radix";
          }
          // Recharts + dependencies
          if (id.includes("node_modules/recharts") ||
              id.includes("node_modules/victory-vendor") ||
              id.includes("node_modules/d3-")) {
            return "vendor-charts";
          }
          // Supabase
          if (id.includes("node_modules/@supabase/")) {
            return "vendor-supabase";
          }
          // TanStack Query
          if (id.includes("node_modules/@tanstack/")) {
            return "vendor-query";
          }
          // Router
          if (id.includes("node_modules/react-router") ||
              id.includes("node_modules/@remix-run/")) {
            return "vendor-router";
          }
          // Forms & validation
          if (id.includes("node_modules/react-hook-form") ||
              id.includes("node_modules/@hookform/") ||
              id.includes("node_modules/zod/")) {
            return "vendor-forms";
          }
          // xlsx (large library)
          if (id.includes("node_modules/xlsx/")) {
            return "vendor-xlsx";
          }
          // UI utilities & misc vendors
          if (id.includes("node_modules/")) {
            return "vendor-misc";
          }
        },
      },
    },
  },
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
