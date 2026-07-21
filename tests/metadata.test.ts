import { readFile } from "node:fs/promises";

test("action metadata declares every safety input and bounded output", async () => {
  const metadata = await readFile("action.yml", "utf8");
  for (const name of [
    "max-deletions",
    "exclude-branches",
    "minimum-closed-age-days",
    "allow-fork-repositories",
    "candidate-branches",
    "outputs-truncated",
  ]) {
    expect(metadata).toContain(`  ${name}:`);
  }
  expect(metadata).toContain("main: dist/index.js");
});

test("GitHub App documentation limits token repository and permissions", async () => {
  const readme = await readFile("README.md", "utf8");
  expect(readme).toContain("repositories: ${{ github.event.repository.name }}");
  expect(readme).toContain("permission-contents: write");
  expect(readme).toContain("permission-pull-requests: read");
  expect(readme).not.toContain("unmerged-pr-branch-cleaner@v1");
});

test("CI has credential-safe checkout and a local action smoke job", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("uses: ./");
  expect(workflow).toContain("github-token: ${{ github.token }}");
});
