import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import { buildThirdPartyNotices } from "./license-inventory.mjs";

const pnpmExecutable = process.env.npm_execpath;
if (!pnpmExecutable) {
  throw new Error("Run this script through pnpm (pnpm run licenses).");
}

const installedGraph = JSON.parse(
  execFileSync(
    process.execPath,
    [pnpmExecutable, "list", "--prod", "--depth", "Infinity", "--json"],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  ),
);
const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
const output = await buildThirdPartyNotices({
  installedGraph,
  projectRoot: process.cwd(),
  expectedDirectDependencies: Object.keys(rootPackage.dependencies ?? {}),
});

const target = "THIRD_PARTY_NOTICES.md";
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = await readFile(target, "utf8");
  } catch {
    // A missing notice file is reported as stale below.
  }
  if (current !== output) {
    console.error(`${target} is stale. Run pnpm run licenses.`);
    process.exit(1);
  }
} else {
  await writeFile(target, output);
}
