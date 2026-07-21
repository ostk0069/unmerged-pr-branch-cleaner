# Security Policy

## Supported versions

Until the first release, only the latest commit on `main` is supported. After release, the latest major release line will receive security fixes.

## Reporting a vulnerability

Please use GitHub's **Private vulnerability reporting** on the repository Security tab. Do not open a public issue for suspected vulnerabilities or include secrets, tokens, or exploit details in an issue. If private reporting is unavailable, contact the maintainer through the private contact method listed on their GitHub profile.

Reports should include affected versions, impact, reproduction steps, and any suggested mitigation. You should receive an initial acknowledgement within seven days.

## Security validation scope

CI exercises deletion behavior with mocked GitHub REST/GraphQL clients and runs the bundled action against live repository metadata only in read-only dry-run mode. It does not perform destructive deletion E2E testing. Security reports involving GitHub API behavior that cannot be reproduced by these checks are especially valuable.
