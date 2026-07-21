import { access, readFile } from "node:fs/promises";

const action = await readFile("action.yml", "utf8");
const match = action.match(/^\s*main:\s*(\S+)\s*$/m);
if (!match) throw new Error("action.yml does not declare runs.main.");
await access(match[1]);
for (const input of [
  "max-deletions",
  "exclude-branches",
  "minimum-closed-age-days",
  "allow-fork-repositories",
]) {
  if (!action.includes(`  ${input}:`))
    throw new Error(`Missing action input: ${input}`);
}
console.log("Action metadata and bundled entry point are valid.");
