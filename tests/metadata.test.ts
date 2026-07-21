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

test("release metadata consistently identifies the initial v0 release", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    version: string;
  };
  const security = await readFile("SECURITY.md", "utf8");
  const contributing = await readFile("CONTRIBUTING.md", "utf8");
  expect(packageJson.version).toBe("0.0.1");
  expect(security).toContain("latest `0.0.x` release");
  expect(contributing).toContain(
    "create `v0.0.1` as an immutable GitHub release",
  );
  expect(contributing).toContain("move the `v0` tag");
});

test("GitHub App documentation limits token repository and permissions", async () => {
  const readme = await readFile("README.md", "utf8");
  expect(readme).toContain("repositories: ${{ github.event.repository.name }}");
  expect(readme).toContain("permission-contents: write");
  expect(readme).toContain("permission-pull-requests: read");
  expect(readme).toContain("unmerged-pr-branch-cleaner@v0");
  expect(readme).not.toMatch(/unmerged-pr-branch-cleaner@v[1-9]/);
  expect(readme).not.toContain("@<full-commit-sha>");
  expect(readme).toContain(
    "Pin both Actions to reviewed full commit SHAs in production.",
  );
  expect(readme).toContain(
    "actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349 # v2.2.2",
  );
});

test("CI has credential-safe checkout and a local action smoke job", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("uses: ./");
  expect(workflow).toContain("github-token: ${{ github.token }}");
});
