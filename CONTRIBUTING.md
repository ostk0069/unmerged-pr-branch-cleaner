# Contributing

## Development

Use Node.js 24. Install and validate with:

```sh
npm install --global pnpm@11.15.1
pnpm install --frozen-lockfile
pnpm run format
pnpm run package
pnpm run licenses
pnpm run check-all
pnpm audit --audit-level=moderate
```

The `packageManager` field pins pnpm 11.15.1. pnpm verifies downloaded package tarballs against integrity metadata provided by the npm registry. CI pins `pnpm/action-setup` separately to a reviewed full commit SHA, confirms the installed pnpm version, and installs project dependencies from the frozen lockfile. The version-confirmation step alone permits a package-manager fallback download without the minimum release age; dependency installation still enforces the 24-hour delay. Supply-chain settings reject unreviewed dependency build scripts, packages published within the last 24 hours, trust downgrades, and exotic transitive dependency sources. If an update introduces a lifecycle script, review the exact package version before adding it to `allowBuilds` in `pnpm-workspace.yaml`.

Corepack is not required. When updating the CI bootstrap Action, keep it pinned to a reviewed full commit SHA rather than a mutable tag.

GitHub's published Dependabot compatibility table currently documents pnpm lockfile updates through pnpm 10, so a pnpm 11 lockfile update may fail even though the `npm` package ecosystem remains configured. If that happens, a maintainer should update dependencies locally with the pinned pnpm 11 version and let CI validate the result. Renovate is intentionally not added solely as a fallback, keeping the maintenance and token surface small.

Commit changes to `dist/index.js` and `THIRD_PARTY_NOTICES.md` whenever source or production dependencies change. Pull requests should explain behavioral and security effects and add tests for every safety decision.

CI downloads the upstream `rhysd/actionlint` release binary directly and verifies its published SHA256 before execution, avoiding an additional third-party Action with workflow privileges. To update it, change the version in the release URL and step name plus the matching `linux_amd64` SHA256 from the upstream release checksum file in `.github/workflows/ci.yml`, then run `actionlint` locally.

## Release checklist

1. Run the full commands above from a clean checkout.
2. Confirm actionlint and CI's local `uses: ./` live read-only dry-run smoke test succeed. Actual deletion is covered by mocked GraphQL tests, not destructive CI E2E.
3. Review bundled dependency licenses and the dependency audit.
4. Merge to protected `main` with required CI checks.
5. Enable GitHub Immutable Releases for the repository before publishing. The repository setting must enforce that each full-version release and its tag cannot be changed or deleted after publication.
6. Complete the first Marketplace publication in GitHub's web UI; the CLI and API alone cannot complete it. From the banner above the repository's root `action.yml`, select **Draft a release**. If prompted, the repository owner must accept the GitHub Marketplace Developer Agreement. Target the reviewed `main` commit with tag and release title `v0.0.1`, select **Publish this Action to the GitHub Marketplace**, and resolve any metadata or name-uniqueness errors until the form reports **Everything looks good!**. Select **Utilities** as the Primary Category, optionally select a secondary category, and use the owner's two-factor authentication to create `v0.0.1` as an immutable GitHub release by publishing it.
7. After `v0.0.1` exists and its commit is verified, create or move the `v0` tag to that exact commit without associating `v0` with a GitHub release. Move `v0` only to backward-compatible releases. Although SemVer permits breaking changes within `0.x`, do not move `v0` across a breaking change; establish a new major compatibility line and tag instead. Full-version releases and tags remain immutable, while compatibility tags are intentionally mutable.
8. Verify that the README examples using `@v0` resolve to the same reviewed commit and that `package.json`, the release, and supported-version documentation all identify `v0.0.1` / `0.0.x` consistently. Package registry publishing and automated semantic release are intentionally out of scope.
