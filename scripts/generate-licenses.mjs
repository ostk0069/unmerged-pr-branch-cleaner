import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const sections = [];
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path.startsWith("node_modules/") || metadata.dev) continue;
  const directory = path;
  let entries;
  try {
    entries = await readdir(directory);
  } catch {
    throw new Error(
      `Run npm ci before generating licenses (${directory} is missing).`,
    );
  }
  const licenseFile = entries.find((entry) =>
    /^(license|copying)(\.|$)/i.test(entry),
  );
  if (!licenseFile)
    throw new Error(
      `No license file found for ${metadata.name ?? basename(path)}.`,
    );
  const licenseText = (
    await readFile(join(directory, licenseFile), "utf8")
  ).trim();
  const packageJson = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  );
  sections.push(
    `## ${packageJson.name}@${packageJson.version}\n\nLicense: ${packageJson.license ?? "See text below"}\n\n${licenseText}`,
  );
}
sections.sort();
const output = `# Third-Party Notices\n\nThis distribution includes the following production dependencies.\n\n${sections.join("\n\n---\n\n")}\n`;
const target = "THIRD_PARTY_NOTICES.md";
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = await readFile(target, "utf8");
  } catch {
    // A missing notice file is reported as stale below.
  }
  if (current !== output) {
    console.error(`${target} is stale. Run npm run licenses.`);
    process.exit(1);
  }
} else {
  await writeFile(target, output);
}
