import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(root, "build", "linux-after-install.sh");
const removeHook = path.join(root, "build", "linux-after-remove.sh");
const temporaryDirectories = [];

function fixture() {
  const appRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "alca-deb-upgrade-"));
  temporaryDirectories.push(appRoot);
  const resources = path.join(appRoot, "resources");
  const cuaRoot = path.join(resources, "cua-linux-x64");
  fs.mkdirSync(cuaRoot, { recursive: true, mode: 0o775 });
  for (const directory of [appRoot, resources, cuaRoot]) fs.chmodSync(directory, 0o775);
  for (const executable of ["cua-driver", "cua-cursor-theme"]) {
    fs.writeFileSync(path.join(cuaRoot, executable), "fixture", { mode: 0o664 });
    fs.chmodSync(path.join(cuaRoot, executable), 0o664);
  }
  const chromiumSandbox = path.join(appRoot, "chrome-sandbox");
  fs.writeFileSync(chromiumSandbox, "fixture", { mode: 0o664 });
  fs.chmodSync(chromiumSandbox, 0o664);
  const systemRoot = path.join(appRoot, "test-system");
  const apparmorDir = path.join(systemRoot, "apparmor.d");
  fs.mkdirSync(apparmorDir, { recursive: true });
  fs.chmodSync(apparmorDir, 0o755);
  const parser = path.join(systemRoot, "apparmor_parser");
  fs.writeFileSync(parser, '#!/bin/sh\nprintf "profile operation: %s %s\\n" "$1" "$2"\n', { mode: 0o755 });
  const apparmorStatus = path.join(systemRoot, "apparmor_status");
  fs.writeFileSync(apparmorStatus, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(systemRoot, "apparmor-profiles"), "alcabots-browser (unconfined)\n");
  return { appRoot, resources, cuaRoot, chromiumSandbox, systemRoot, apparmorDir, parser, apparmorStatus };
}

function runHook(appRoot) {
  return spawnSync("/bin/sh", [hook], {
    encoding: "utf8",
    env: { ...process.env, ALCABOTS_POSTINSTALL_TEST_ROOT: appRoot },
  });
}

/** The browser policy an earlier version installed, which the remove hook still unloads and deletes. */
function legacyProfile(apparmorDir) {
  const profile = path.join(apparmorDir, "alcabots-browser");
  fs.writeFileSync(profile, "profile alcabots-browser /opt/AlcaBots/resources/browser-engine/chrome flags=(unconfined) { userns, }\n", { mode: 0o644 });
  return profile;
}

function runRemoveHook(appRoot, operation = "remove") {
  return spawnSync("/bin/sh", [removeHook, operation], {
    encoding: "utf8",
    env: { ...process.env, ALCABOTS_POSTINSTALL_TEST_ROOT: appRoot },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Linux DEB sandbox policy", () => {
  it.skipIf(process.platform === "win32")("keeps both privileged hooks valid POSIX shell", () => {
    for (const script of [hook, removeHook]) {
      const result = spawnSync("/bin/sh", ["-n", script], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    }
  });
});

describe.skipIf(process.platform !== "linux")("Linux DEB upgrade hook", () => {
  it("repairs legacy directory and executable modes idempotently", () => {
    const { appRoot, resources, cuaRoot, chromiumSandbox } = fixture();

    for (let pass = 0; pass < 2; pass += 1) {
      const result = runHook(appRoot);
      expect(result.status, result.stderr).toBe(0);
      for (const directory of [appRoot, resources, cuaRoot]) {
        expect(fs.lstatSync(directory).mode & 0o777).toBe(0o755);
      }
      for (const executable of ["cua-driver", "cua-cursor-theme"]) {
        expect(fs.lstatSync(path.join(cuaRoot, executable)).mode & 0o777).toBe(0o755);
      }
      expect(fs.lstatSync(chromiumSandbox).mode & 0o7777).toBe(0o4755);
    }
  });

  it("refuses to follow a replaced package directory symlink", () => {
    const { appRoot, resources } = fixture();
    const external = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "alca-deb-external-"));
    temporaryDirectories.push(external);
    fs.chmodSync(external, 0o777);
    fs.rmSync(resources, { recursive: true });
    fs.symlinkSync(external, resources, "dir");

    const result = runHook(appRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing or unsafe");
    expect(fs.lstatSync(external).mode & 0o777).toBe(0o777);
  });

  it("fails the install when a bundled executable is missing", () => {
    const { appRoot, cuaRoot } = fixture();
    fs.unlinkSync(path.join(cuaRoot, "cua-driver"));

    const result = runHook(appRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("package executable is missing or unsafe");
  });

  it("fails the install when the Chromium sandbox is replaced by a symlink", () => {
    const { appRoot, chromiumSandbox } = fixture();
    const external = path.join(appRoot, "external-sandbox");
    fs.writeFileSync(external, "fixture", { mode: 0o755 });
    fs.unlinkSync(chromiumSandbox);
    fs.symlinkSync(external, chromiumSandbox, "file");

    const result = runHook(appRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Chromium sandbox is missing or unsafe");
  });

  it("keeps an earlier version's browser profile on upgrade and removes only that policy on uninstall", () => {
    const { appRoot, apparmorDir } = fixture();
    const profile = legacyProfile(apparmorDir);
    const unrelated = path.join(apparmorDir, "another-app");
    fs.writeFileSync(unrelated, "unrelated policy");
    expect(runRemoveHook(appRoot, "upgrade").status).toBe(0);
    expect(fs.existsSync(profile)).toBe(true);
    const removed = runRemoveHook(appRoot);
    expect(removed.status, removed.stderr).toBe(0);
    expect(removed.stdout).toContain(`profile operation: -R ${profile}`);
    expect(fs.existsSync(profile)).toBe(false);
    expect(fs.readFileSync(unrelated, "utf8")).toBe("unrelated policy");
    expect(runRemoveHook(appRoot, "purge").status).toBe(0);
  });

  it("removes an already unloaded profile without asking the kernel again", () => {
    const { appRoot, apparmorDir, systemRoot } = fixture();
    legacyProfile(apparmorDir);
    fs.writeFileSync(path.join(systemRoot, "apparmor-profiles"), "another-app (enforce)\n");
    const result = runRemoveHook(appRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("profile operation");
    expect(fs.existsSync(path.join(apparmorDir, "alcabots-browser"))).toBe(false);
  });

  it("removes staged policy without kernel operations when AppArmor is disabled", () => {
    const { appRoot, apparmorDir, apparmorStatus, parser } = fixture();
    legacyProfile(apparmorDir);
    fs.writeFileSync(apparmorStatus, "#!/bin/sh\nexit 1\n");
    fs.writeFileSync(parser, "#!/bin/sh\nexit 1\n");
    const result = runRemoveHook(appRoot);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("profile operation");
    expect(fs.existsSync(path.join(apparmorDir, "alcabots-browser"))).toBe(false);
  });

  it("keeps the exact policy available for repair if the kernel refuses to unload it", () => {
    const { appRoot, apparmorDir, parser } = fixture();
    legacyProfile(apparmorDir);
    fs.writeFileSync(parser, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = runRemoveHook(appRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("could not unload");
    expect(fs.existsSync(path.join(apparmorDir, "alcabots-browser"))).toBe(true);
  });

  it("does not delete a loaded policy when its AppArmor parser is missing", () => {
    const { appRoot, apparmorDir, parser } = fixture();
    legacyProfile(apparmorDir);
    fs.unlinkSync(parser);
    const result = runRemoveHook(appRoot);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("needs apparmor_parser to unload");
    expect(fs.existsSync(path.join(apparmorDir, "alcabots-browser"))).toBe(true);
  });

  it("rejects a test override outside the private temporary root", () => {
    const result = runHook(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must stay under /tmp");
  });

  it("resolves the test root before applying the temporary-directory boundary", () => {
    const escaped = path.join(fs.realpathSync(os.tmpdir()), "..", path.relative("/", root));
    const result = runHook(escaped);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must stay under /tmp");
  });
});
