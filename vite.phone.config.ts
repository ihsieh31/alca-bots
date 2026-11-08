// The phone's site, built on its own because it is hosted away from any computer: the relay's --site or any static host.
import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

import { SITE_CSP, SITE_HEADERS } from "./link/relay/server.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const outDir = resolve(root, "dist-phone");

const servedAtRoot: Plugin = {
  name: "phone-served-at-root",
  closeBundle: () => {
    renameSync(resolve(outDir, "phone.html"), resolve(outDir, "index.html"));
    // A static host that reads this file (Cloudflare among them) serves what the relay's --site serves. no-transform
    // keeps a host from adding its own analytics script, which the CSP would refuse anyway.
    const headers = { ...SITE_HEADERS, "content-security-policy": SITE_CSP, "cache-control": "public, max-age=0, must-revalidate, no-transform" };
    const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);
    writeFileSync(resolve(outDir, "_headers"), `/*\n${lines.join("\n")}\n`);
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), servedAtRoot],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: { outDir, emptyOutDir: true, rollupOptions: { input: resolve(root, "phone.html") } },
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0") },
});
