# Contributing

## Development

Use Node.js 24. Install and validate with:

```sh
npm ci
npm run format
npm run package
npm run licenses
npm run check-all
npm audit --audit-level=moderate
```

Commit changes to `dist/index.js` and `THIRD_PARTY_NOTICES.md` whenever source or production dependencies change. Pull requests should explain behavioral and security effects and add tests for every safety decision.

CI downloads the upstream `rhysd/actionlint` release binary directly and verifies its published SHA256 before execution, avoiding an additional third-party Action with workflow privileges. To update it, change the version in the release URL and step name plus the matching `linux_amd64` SHA256 from the upstream release checksum file in `.github/workflows/ci.yml`, then run `actionlint` locally.

## Release checklist

1. Run the full commands above from a clean checkout.
2. Confirm actionlint and CI's local `uses: ./` live read-only dry-run smoke test succeed. Actual deletion is covered by mocked GraphQL tests, not destructive CI E2E.
3. Review bundled dependency licenses and the dependency audit.
4. Merge to protected `main` with required CI checks.
5. Create an immutable semantic-version release and major tag only from the reviewed commit.
6. Update README examples only after the release exists. npm publishing and automated semantic release are intentionally out of scope.
