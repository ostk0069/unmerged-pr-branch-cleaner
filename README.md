# Unmerged PR Branch Cleaner

Safely deletes same-repository branches associated with pull requests that were closed without being merged.

> [!IMPORTANT]
> No release exists yet. The examples intentionally use `@<full-commit-sha>` as a non-copyable placeholder. After the first immutable release, replace it with its full 40-character commit SHA. A moving `@v1` tag may be offered for convenience only after release.

## Safety model

The action paginates all pull requests and branches, then selects only closed, unmerged PRs whose head and base are in the current repository. It excludes forks, missing branches, default/protected branches, ambiguous SHA histories, exclusions, branches that are too young, and every same-repository branch used as either the head or base of an open PR. It repeats the repository, open-PR head/base, protection, exclusion, and SHA checks before any mutation.

Deletion uses GitHub GraphQL `updateRefs` with `beforeOid` set to the expected closed-PR SHA and a zero `afterOid`. This compare-and-delete prevents a concurrent push from being silently deleted. Mutations are spaced by at least one second. A rate-limit response stops the run immediately without retrying or attempting later branches.

Each branch deletion is atomic, but the entire run is not a transaction. If a later branch fails or encounters a rate limit, earlier successful deletions remain deleted and every remaining branch is reported as `not attempted after fatal error`. Fix the cause and re-run; already missing branches are safely ignored during discovery.

`dry-run` defaults to `true`. For actual deletion, every candidate first passes final checks; if the total exceeds `max-deletions`, the action fails before deleting anything.

## Scheduled dry run

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
      - uses: ostk0069/unmerged-pr-branch-cleaner@<full-commit-sha>
        with:
          dry-run: "true"
          max-deletions: "20"
          minimum-closed-age-days: "7"
          exclude-branches: |
            release/**
            keep-*
```

After reviewing candidates, set `dry-run: "false"` and grant `contents: write`. Pin third-party actions to a full commit SHA.

## GitHub App token

The App needs `Contents: read and write` and `Pull requests: read`. Scope its installation token to only the current repository:

```yaml
- name: Generate GitHub App token
  id: app-token
  uses: actions/create-github-app-token@<full-commit-sha>
  with:
    app-id: ${{ secrets.GH_APP_ID }}
    private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}
    repositories: ${{ github.event.repository.name }}
    permission-contents: write
    permission-pull-requests: read

- uses: ostk0069/unmerged-pr-branch-cleaner@<full-commit-sha>
  with:
    github-token: ${{ steps.app-token.outputs.token }}
    dry-run: "false"
```

Repository rulesets can still block deletion unless the App has an appropriate bypass.

## Inputs

| Name                      | Default        | Description                                                                          |
| ------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `github-token`            | `github.token` | Token used for Pull requests, repository, and ref APIs                               |
| `dry-run`                 | `true`         | Report candidates without deleting                                                   |
| `max-deletions`           | `20`           | Positive hard cap for a non-dry-run invocation                                       |
| `exclude-branches`        | empty          | Comma/newline-separated minimatch glob patterns, checked initially and finally       |
| `minimum-closed-age-days` | `0`            | Non-negative age required for the newest closed PR associated with the candidate SHA |
| `allow-fork-repositories` | `false`        | Explicit opt-in to run when the repository itself is a fork                          |

## Outputs

`candidate-count` and `candidate-branches` describe branches that passed all final safety checks; in dry-run these are the would-delete branches. `deleted-count` remains the actual total for compatibility. `deleted-total`, `skipped-total`, and `failed-total` are never truncated.

The JSON detail outputs `candidate-branches`, `deleted-branches`, `skipped-branches`, and `failed-branches` each have a conservative 80 KiB UTF-8 budget. `outputs-truncated` is `true` if any detail array was shortened. Use the total outputs for accounting. The job summary shows at most 50 escaped detail rows.

## Limitations

- Only refs in the current repository are eligible; cross-repository deletion is not supported.
- Running in a repository that is itself a fork is rejected by default because upstream open-PR relationships may not be visible. Opting in accepts that limitation.
- Protected branches, default branches, and ruleset-denied refs are not deleted. The token needs Pull requests/Contents read and, for deletion, Contents write.
- GitHub may delay scheduled workflows. Discovery is sequential and can take time in large repositories.
- Rate limits fail closed and are not retried. Re-run later rather than adding a long-lived retry loop.
- Atomic compare-and-delete protects branch contents from changing between the SHA check and deletion. An open PR can still be created with the branch as its base after the immediate filtered open-PR check; GitHub does not offer one transaction spanning PR creation and ref deletion.
- A deleted and recreated ref at exactly the same name and SHA cannot be distinguished from its previous identity.

## CI coverage

CI runs unit tests with mocked REST and GraphQL clients, including the expected-SHA `updateRefs` delete request, then executes the committed bundle through `uses: ./` as a live, read-only dry run. CI intentionally does not perform an actual branch deletion. A destructive E2E workflow would require a separately approved fixture repository and lifecycle policy.

## Development

Node.js 24 is required.

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run check-all
```

The package manager is pinned to pnpm 11.15.1. `pnpm run package` regenerates committed `dist/index.js`. `pnpm run licenses` regenerates production dependency notices. See [CONTRIBUTING.md](CONTRIBUTING.md) for the release checklist.

Marketplace users do not install pnpm or project dependencies. GitHub Actions runs the committed `dist/index.js` bundle directly with Node.js 24, so this package-manager choice affects only contributors and CI.

## License

MIT. Bundled production dependency licenses are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
