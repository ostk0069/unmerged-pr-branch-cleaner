# Unmerged PR Branch Cleaner

Safely removes same-repository branches left behind by pull requests that were closed without being merged.

Eligible only when:

- A same-repository branch is linked to a closed, unmerged PR.
- Its related closed PRs resolve to one unchanged SHA, and the newest has reached the configured minimum age.
- It passes the action's preflight checks.

Skipped when detected:

- A fork head, default or protected branch, excluded branch, ambiguous history, changed branch, or branch used by an open PR as its head or base.

## Quick start: safe dry-run

`dry-run` defaults to `true`. Start with a manually dispatched workflow so that every run is intentional while you review the discovered branches:

```yaml
name: Clean up unmerged PR branches

on:
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
      - uses: ostk0069/unmerged-pr-branch-cleaner@v0
        with:
          dry-run: "true"
          max-deletions: "20"
          minimum-closed-age-days: "7"
          exclude-branches: |
            release/**
            keep-*
```

The seven-day minimum age and `release/**` / `keep-*` exclusions are example policies. Customize or remove them to match your repository. Keep the same values when enabling deletion so the reviewed dry-run and deletion scopes match.

For an immutable dependency, replace `@v0` with the full commit SHA of a reviewed release. Do not invent a SHA; copy it from the release commit on GitHub.

## Enable deletion

After reviewing dry-run results, keep the same inputs, grant write access, and explicitly disable dry-run:

```yaml
name: Clean up unmerged PR branches

on:
  workflow_dispatch:

concurrency:
  group: unmerged-pr-branch-cleaner
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: read

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: ostk0069/unmerged-pr-branch-cleaner@v0
        with:
          dry-run: "false"
          max-deletions: "20"
          minimum-closed-age-days: "7"
          exclude-branches: |
            release/**
            keep-*
```

## Optional scheduled runs

After validating the workflow manually, you can add a schedule. Schedules are repository policy; choose a cadence appropriate for your project. For example, to run weekly at 00:00 UTC:

```yaml
on:
  schedule:
    - cron: "0 0 * * 1"
  workflow_dispatch:
```

Adding a schedule changes only when the workflow runs. Keep the deletion workflow's inputs identical to the reviewed dry-run inputs.

## Inputs

| Name                      | Required | Default        | Description                                                                                                                  |
| ------------------------- | -------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `github-token`            | No       | `github.token` | Token used to read pull requests, repository data, and refs. Deletion also requires Contents write.                          |
| `dry-run`                 | No       | `true`         | Reports branches that would be deleted without mutating refs.                                                                |
| `max-deletions`           | No       | `20`           | Positive deletion cap. A non-dry-run exceeding it fails before any deletion; dry-run only reports that the cap was exceeded. |
| `exclude-branches`        | No       | empty          | Comma- or newline-separated minimatch patterns that are checked during discovery and again before deletion.                  |
| `minimum-closed-age-days` | No       | `0`            | Minimum whole-day age of the newest related closed PR.                                                                       |
| `allow-fork-repositories` | No       | `false`        | Explicitly permits running when the current repository is itself a fork. Review the fork limitation first.                   |

## Outputs

| Name                 | Type                      | Meaning                                                                                     |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `candidate-count`    | decimal string            | Number of branches that passed the preflight checks.                                        |
| `candidate-branches` | JSON `string[]`           | Branches that passed the preflight checks. In dry-run, this is the would-attempt snapshot.  |
| `deleted-total`      | decimal string            | Total branches deleted.                                                                     |
| `deleted-branches`   | JSON `string[]`           | Deleted branch names.                                                                       |
| `skipped-total`      | decimal string            | Total skipped outcomes.                                                                     |
| `skipped-branches`   | JSON `{branch, reason}[]` | Branches not acted on and the reason.                                                       |
| `failed-total`       | decimal string            | Total failed outcomes.                                                                      |
| `failed-branches`    | JSON `{branch, reason}[]` | Branches that could not be safely processed and the reason.                                 |
| `outputs-truncated`  | boolean string            | Whether one or more detailed JSON outputs were shortened; use total outputs for accounting. |

Output categories are not mutually exclusive. In dry-run, each candidate is also recorded in `skipped-branches` with `dry-run: would delete`. Runs containing only skipped outcomes succeed. Any failed outcome, fatal error, non-dry-run `max-deletions` breach, or fatal rate-limit condition fails the step; branches not attempted after a fatal error are reported as skipped.

Each detailed JSON array has an 80 KiB output budget. When `outputs-truncated` is `true`, use the corresponding total output for accounting.

## Safety model

- The action only considers closed, unmerged PRs whose head and base repositories are the current repository.
- When detected, the default branch, protected branches, excluded branches, and branches used as the head or base of an open PR are reserved.
- Multiple closed-PR head SHAs for the same branch are treated as ambiguous history and skipped.
- The current branch SHA must match the expected closed-PR head SHA. Deletion is conditional on that expected SHA, so a concurrent push is not silently removed.
- Repository state, branch protection, exclusions, and open-PR head/base usage are checked again before mutation. Open-PR head and base filters are checked immediately before each deletion, subject to the race described under Limitations.
- A non-dry-run exceeding `max-deletions` stops before the first deletion. Dry-run remains informational.
- Mutations are paced, and a detected rate limit stops later deletion attempts without retrying.
- The action fails closed when required repository or pull-request state cannot be verified.

## Advanced authentication with a GitHub App

The default `github.token` is enough for dry-run with read permissions. For deletion, first install a GitHub App on the target repository and grant the App **Contents: Read and write** and **Pull requests: Read** repository permissions.

Then generate a token scoped to only the current repository. The `permission-*` inputs below narrow permissions already granted to the App installation; they cannot elevate an App that lacks those permissions:

```yaml
- name: Generate GitHub App token
  id: app-token
  uses: actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349 # v2.2.2
  with:
    app-id: ${{ secrets.GH_APP_ID }}
    private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}
    repositories: ${{ github.event.repository.name }}
    permission-contents: write
    permission-pull-requests: read

- uses: ostk0069/unmerged-pr-branch-cleaner@v0
  with:
    github-token: ${{ steps.app-token.outputs.token }}
    dry-run: "false"
```

Pin both Actions to reviewed full commit SHAs in production. Repository rulesets may still require the App to be configured as an allowed bypass actor.

## Limitations

- Only branches in the current repository are eligible; cross-repository and fork-head deletion are not supported.
- Running in a repository that is itself a fork is rejected by default because upstream open-PR relationships may not be visible. Opting in accepts that limitation.
- Branch protection and repository rulesets can deny deletion even when the token has Contents write.
- A run is not transactional. If a later deletion fails, earlier successful deletions remain deleted.
- An open PR can be created after the immediate pre-delete check; GitHub does not provide one transaction covering PR creation and ref deletion.
- A branch deleted and recreated at the same name and SHA cannot be distinguished from its previous identity. Ambiguous branch histories are skipped.
- Discovery paginates repository branches and pull requests. Large repositories can consume significant API quota and take longer to process.
- Scheduled workflows run from the default branch, can be delayed by GitHub, and may be disabled in inactive repositories.
- GitHub Enterprise Server has not been tested.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

To report a vulnerability, follow [SECURITY.md](SECURITY.md).

## License

MIT. Bundled dependency notices are available in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
