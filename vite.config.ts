import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || "/",
    server: {
      proxy: {
        "/election-assets": {
          target: "http://127.0.0.1:63343",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/election-assets/, ""),
        },
        "/test-feed": {
          target: "http://127.0.0.1:63343",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/test-feed/, ""),
        },
      },
    },
    test: { environment: "node" },
  };
});
