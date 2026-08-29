import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import wasm from "vite-plugin-wasm";
import path from "path";

export default defineConfig(({ mode }) => {
  // Vite does not expose `.env.local` through `process.env` in the config file;
  // load it explicitly so the walletd proxy target tracks `.env.local`.
  const env = loadEnv(mode, process.cwd());
  const walletdTarget = env.VITE_WALLETD_TARGET ?? "http://localhost:5100";

  return {
    plugins: [tailwindcss(), reactRouter(), wasm()],
    build: {
      // The WASM bindings use top-level await. Targeting esnext means modern
      // browsers handle it natively, so we don't need vite-plugin-top-level-await.
      target: "esnext",
    },
    resolve: {
      alias: {
        "~": path.resolve(import.meta.dirname, "./app"),
        "@/lib": path.resolve(import.meta.dirname, "./lib"),
      },
    },
    server: {
      // Bind to IPv4 explicitly: on Node 17+ `localhost` resolves to `::1`, which
      // the browser reaches but Cypress (which resolves `localhost` to 127.0.0.1)
      // cannot. Keeping everything on 127.0.0.1 avoids the mismatch.
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/walletd": {
          target: walletdTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/walletd/, ""),
        },
      },
    },
  };
});
