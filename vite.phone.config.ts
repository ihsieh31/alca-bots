// The phone's site, built on its own because it is hosted away from any computer: the relay's --site or any static host.
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const outDir = resolve(root, "dist-phone");

const servedAtRoot: Plugin = {
  name: "phone-served-at-root",
  closeBundle: () => renameSync(resolve(outDir, "phone.html"), resolve(outDir, "index.html")),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), servedAtRoot],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: { outDir, emptyOutDir: true, rollupOptions: { input: resolve(root, "phone.html") } },
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0") },
});
