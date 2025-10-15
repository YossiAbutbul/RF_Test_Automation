import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "src"),
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
  },
  server: {
    proxy: {
      "/analyzer": {
        target: "http://localhost:8000",
        changeOrigin: true,
        secure: false,
      },
      // NEW: stream endpoints & other test routes
      "/tests": {
        target: "http://localhost:8000",
        changeOrigin: true,
        secure: false,
        ws: true, // not required for SSE, but harmless
        // SSE works fine through http-proxy; no special rewrite needed
      },
    },
  },
});
