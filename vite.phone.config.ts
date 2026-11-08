// The phone's site, built on its own because it is hosted away from any computer: the relay's --site or any static host.
import { createHash } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { build as esbuild } from "esbuild";
import { defineConfig, type Plugin } from "vite";

import { SITE_CSP, SITE_HEADERS } from "./link/relay/server.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const outDir = resolve(root, "dist-phone");

// What the phone needs to open with no network. Language packs and code highlighting stay out: they are large, and are
// kept once they have been used.
const ALWAYS_PRECACHED = ["/", "/manifest.webmanifest", "/app-icon.svg", "/app-icon-192.png", "/app-icon-512.png", "/apple-touch-icon.png"];

interface OutChunk {
  type: "chunk";
  fileName: string;
  isEntry: boolean;
  name: string;
  imports: string[];
  dynamicImports: string[];
  viteMetadata?: { importedCss: Set<string> };
}

function shellFiles(bundle: Record<string, { type: string; fileName: string }>): string[] {
  const chunks = Object.values(bundle).filter((file): file is OutChunk => file.type === "chunk");
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const files = new Set<string>();
  const visit = (chunk: OutChunk | undefined) => {
    if (!chunk || files.has(chunk.fileName)) return;
    files.add(chunk.fileName);
    for (const css of chunk.viteMetadata?.importedCss ?? []) files.add(css);
    for (const name of chunk.imports) visit(byName.get(name));
    for (const name of chunk.dynamicImports) {
      const dynamic = byName.get(name);
      if (dynamic?.name === "PhoneApp") visit(dynamic);
    }
  };
  for (const chunk of chunks) if (chunk.isEntry) visit(chunk);
  return Array.from(files, (name) => `/${name}`).sort();
}

const serviceWorker = (): Plugin => {
  let precache: string[] = [];
  let version = "";
  return {
    name: "phone-service-worker",
    enforce: "post",
    generateBundle(_options, bundle) {
      precache = [...ALWAYS_PRECACHED, ...shellFiles(bundle)];
      version = createHash("sha256").update(Object.keys(bundle).sort().join("\n")).digest("hex").slice(0, 16);
    },
    async closeBundle() {
      await esbuild({
        entryPoints: [resolve(root, "src/phone/sw.ts")],
        outfile: resolve(outDir, "sw.js"),
        bundle: true,
        minify: true,
        format: "iife",
        target: "es2022",
        define: { __SW_VERSION__: JSON.stringify(version), __SW_PRECACHE__: JSON.stringify(precache) },
      });
    },
  };
};

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
  plugins: [react(), tailwindcss(), serviceWorker(), servedAtRoot],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: { outDir, emptyOutDir: true, rollupOptions: { input: resolve(root, "phone.html") } },
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0") },
});
