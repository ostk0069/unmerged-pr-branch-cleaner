import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildThirdPartyNotices } from "./license-inventory.mjs";

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "license-inventory-"));
  await mkdir(join(root, "node_modules"));
  return root;
}

async function fixturePackage(root, directory, name, version, files = {}) {
  const packageDirectory = join(root, "node_modules", directory);
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({ name, version, license: "MIT" }),
  );
  for (const [file, text] of Object.entries({
    LICENSE: `${name} license`,
    ...files,
  })) {
    await writeFile(join(packageDirectory, file), text);
  }
  return packageDirectory;
}

test("recursively covers nested and optional dependencies without duplicate notices", async () => {
  const root = await fixtureRoot();
  const alpha = await fixturePackage(root, "alpha", "alpha", "1.0.0", {
    "LICENSE-MIT": "alpha MIT license",
    NOTICE: "alpha notice",
  });
  const beta = await fixturePackage(root, "beta", "beta", "2.0.0");
  const gamma = await fixturePackage(root, "gamma", "gamma", "3.0.0");
  const delta = await fixturePackage(root, "delta", "delta", "4.0.0");
  const betaNode = { version: "2.0.0", path: beta };
  const output = await buildThirdPartyNotices({
    installedGraph: [
      {
        dependencies: {
          alpha: {
            version: "1.0.0",
            path: alpha,
            dependencies: { beta: betaNode },
            optionalDependencies: {
              gamma: {
                version: "3.0.0",
                path: gamma,
                dependencies: {
                  beta: {
                    ...betaNode,
                    dependencies: {
                      delta: { version: "4.0.0", path: delta },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
    projectRoot: root,
    expectedDirectDependencies: ["alpha"],
  });

  assert.equal((output.match(/## beta@2\.0\.0/g) ?? []).length, 1);
  assert.match(output, /## alpha@1\.0\.0/);
  assert.match(output, /## gamma@3\.0\.0/);
  assert.match(output, /## delta@4\.0\.0/);
  assert.match(output, /### LICENSE-MIT\n\nalpha MIT license/);
  assert.match(output, /### NOTICE\n\nalpha notice/);
});

test("rejects package paths outside node_modules", async () => {
  const root = await fixtureRoot();
  const outside = await mkdtemp(join(tmpdir(), "outside-package-"));
  await writeFile(
    join(outside, "package.json"),
    JSON.stringify({ name: "escape", version: "1.0.0", license: "MIT" }),
  );
  await writeFile(join(outside, "LICENSE"), "license");

  await assert.rejects(
    buildThirdPartyNotices({
      installedGraph: [
        { dependencies: { escape: { version: "1.0.0", path: outside } } },
      ],
      projectRoot: root,
      expectedDirectDependencies: ["escape"],
    }),
    /resolves outside/,
  );
});

test("rejects package metadata mismatches", async () => {
  const root = await fixtureRoot();
  const path = await fixturePackage(root, "actual", "actual", "1.0.0");
  await assert.rejects(
    buildThirdPartyNotices({
      installedGraph: [
        { dependencies: { expected: { version: "1.0.0", path } } },
      ],
      projectRoot: root,
      expectedDirectDependencies: ["expected"],
    }),
    /metadata mismatch/,
  );
});

test("rejects license symlinks escaping the package directory", async () => {
  const root = await fixtureRoot();
  const path = await fixturePackage(root, "linked", "linked", "1.0.0");
  const outside = join(root, "outside-license");
  await writeFile(outside, "outside");
  await writeFile(join(path, "LICENSE"), "inside");
  await symlink(outside, join(path, "NOTICE"));

  await assert.rejects(
    buildThirdPartyNotices({
      installedGraph: [
        { dependencies: { linked: { version: "1.0.0", path } } },
      ],
      projectRoot: root,
      expectedDirectDependencies: ["linked"],
    }),
    /resolves outside/,
  );
});

test("fails when a declared production dependency is absent", async () => {
  const root = await fixtureRoot();
  await assert.rejects(
    buildThirdPartyNotices({
      installedGraph: [{ dependencies: {} }],
      projectRoot: root,
      expectedDirectDependencies: ["missing"],
    }),
    /missing direct dependencies: missing/,
  );
});
