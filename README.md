# Unmerged PR Branch Cleaner

Safely deletes branches associated with pull requests that were closed without being merged.

> [!IMPORTANT]
> This action has not been published to GitHub Marketplace and no release tag is available yet. The usage examples become usable after the repository and its first release are published.

## Behavior

The action:

- paginates through every closed pull request and selects only unmerged pull requests from the target repository;
- excludes fork pull requests and pull requests whose head repository has been deleted;
- deduplicates branch names while retaining all known closed pull request head SHAs;
- lists repository branches once and intersects them with closed pull request heads, so already deleted branches do not trigger per-branch API calls or appear in outputs;
- excludes branches currently used by any open pull request in the repository;
- skips the default branch, protected branches, branches whose current SHA does not match a selected pull request head SHA, and branches with multiple distinct closed head SHAs (`ambiguous history`);
- checks open pull requests, the default branch, branch protection, and the branch SHA again immediately before deletion;
- treats API and inspection errors as failures and does not delete the affected branch; and
- defaults to dry-run mode and reports deleted, skipped, and failed branches as outputs and in the job summary.

## Scheduled dry run

Start with a dry run and review the job summary before enabling deletion:

```yaml
name: Delete closed unmerged PR branches
on:
  schedule:
    - cron: "0 0 * * 1,4" # Monday and Thursday, 09:00 JST
  workflow_dispatch:

concurrency:
  group: unmerged-pr-branch-cleaner
  cancel-in-progress: false

permissions:
  contents: read
  pull-requests: read

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: ostk0069/unmerged-pr-branch-cleaner@v1
        with:
          dry-run: "true"
```

This example uses the built-in `github.token`. After confirming the candidates, change `dry-run` to `"false"` to perform deletion and change the workflow permission to `contents: write`. Dry runs need `Contents: read` and `Pull requests: read`; deletion additionally needs `Contents: write`.

Replace `@v1` with the full commit SHA of the published release in production. Pinning third-party actions to a full commit SHA protects the workflow from a tag being moved.

## GitHub App token

To use a GitHub App, give the App `Contents: read and write` and `Pull requests: read` repository permissions and pass the generated installation token to this action:

```yaml
name: Delete closed unmerged PR branches
on:
  schedule:
    - cron: "0 0 * * 1,4"
  workflow_dispatch:

concurrency:
  group: unmerged-pr-branch-cleaner
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Generate GitHub App token
        id: app-token
        uses: actions/create-github-app-token@v3
        with:
          app-id: ${{ secrets.GH_APP_ID }}
          private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}

      - uses: ostk0069/unmerged-pr-branch-cleaner@v1
        with:
          github-token: ${{ steps.app-token.outputs.token }}
          dry-run: "false"
```

Pin both actions to full commit SHAs in a production workflow. Repository rulesets can still block an App token unless the App is granted the appropriate bypass permission.

## Inputs

| Name           | Required | Default        | Description                                  |
| -------------- | -------- | -------------- | -------------------------------------------- |
| `github-token` | no       | `github.token` | GitHub token used for API calls and deletion |
| `dry-run`      | no       | `true`         | Discover and report without deleting         |

## Outputs

The action returns `deleted-count`, `deleted-branches` (a JSON array), `skipped-branches`, and `failed-branches`. Skipped and failed entries are JSON objects containing `branch` and `reason`. It writes count-first job summary tables and limits details to 50 rows; outputs retain the complete processed result. Closed PR branches that are already missing are never candidates and are not added to outputs or the summary.

## Limitations

- Only branches in the target repository are eligible. Fork branches are always excluded.
- The default branch and branches reported as protected are never deleted. Repository rulesets or other policy can also deny deletion.
- The supplied token must be able to read pull requests and repository metadata. Actual deletion additionally requires `Contents: write` and any required ruleset bypass permission.
- A scheduled workflow runs only when the workflow file exists on the repository's default branch. GitHub Actions cron schedules use UTC and may be delayed during periods of high load.
- The action uses the GitHub API and is subject to API and secondary rate limits. Discovery errors fail the whole run; per-branch inspection or deletion errors are reported and processing continues. All such errors are fail-closed: no branch is deleted without completing its safety checks.
- A branch can change after the final API check because GitHub does not provide an atomic “check then delete” operation. Matching the current SHA immediately before deletion minimizes this race.
- GitHub does not expose branch identity beyond its name and current SHA. If a branch is deleted and recreated at the exact same SHA, the action cannot distinguish the recreated branch from the original pull request branch.
- Structured outputs contain every processed result and can approach GitHub Actions' output size limits in repositories with exceptionally large cleanup sets. The job summary remains truncated, but consumers should account for this output-size limit.

## Development

Node.js 24 is required.

```sh
npm ci
npm run check-all
```

`npm run package` creates the distributable action. `npm run check:bundle` verifies that committed `dist/` artifacts match the source without relying on Git history. `dist/` is committed because GitHub Actions runs the bundled entry point.

## License

MIT
