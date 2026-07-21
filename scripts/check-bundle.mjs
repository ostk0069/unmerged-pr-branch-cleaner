import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const artifacts = ["dist/index.js", "dist/index.js.map"];

async function readArtifacts() {
  return Promise.all(
    artifacts.map(async (artifact) => {
      try {
        return await readFile(artifact);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    }),
  );
}

const before = await readArtifacts();
const result = spawnSync("npm", ["run", "package"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const after = await readArtifacts();
const changed = artifacts.filter(
  (_artifact, index) =>
    before[index] === null ||
    after[index] === null ||
    !before[index].equals(after[index]),
);
if (changed.length > 0) {
  console.error(
    `Bundled action was stale and has been regenerated: ${changed.join(", ")}`,
  );
  process.exit(1);
}

console.log("Bundled action is current.");
