# Contributing

## Development

Use Node.js 24. Install and validate with:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run format
pnpm run package
pnpm run licenses
pnpm run check-all
pnpm audit --audit-level=moderate
```

The repository pins pnpm 11.15.1 and verifies the frozen lockfile in CI. Supply-chain settings reject unreviewed dependency build scripts, packages published within the last 24 hours, trust downgrades, and exotic transitive dependency sources. If an update introduces a lifecycle script, review the exact package version before adding it to `allowBuilds` in `pnpm-workspace.yaml`.

GitHub's published Dependabot compatibility table currently documents pnpm lockfile updates through pnpm 10, so a pnpm 11 lockfile update may fail even though the `npm` package ecosystem remains configured. If that happens, a maintainer should update dependencies locally with the pinned pnpm 11 version and let CI validate the result. Renovate is intentionally not added solely as a fallback, keeping the maintenance and token surface small.

Commit changes to `dist/index.js` and `THIRD_PARTY_NOTICES.md` whenever source or production dependencies change. Pull requests should explain behavioral and security effects and add tests for every safety decision.

CI downloads the upstream `rhysd/actionlint` release binary directly and verifies its published SHA256 before execution, avoiding an additional third-party Action with workflow privileges. To update it, change the version in the release URL and step name plus the matching `linux_amd64` SHA256 from the upstream release checksum file in `.github/workflows/ci.yml`, then run `actionlint` locally.

## Release checklist

1. Run the full commands above from a clean checkout.
2. Confirm actionlint and CI's local `uses: ./` live read-only dry-run smoke test succeed. Actual deletion is covered by mocked GraphQL tests, not destructive CI E2E.
3. Review bundled dependency licenses and the dependency audit.
4. Merge to protected `main` with required CI checks.
5. Create an immutable semantic-version release and major tag only from the reviewed commit.
6. Update README examples only after the release exists. Package registry publishing and automated semantic release are intentionally out of scope.
