# Dependency cleanup summary

## Execution log
- Ran `npm install --package-lock-only` to refresh lockfiles after manifest edits.
- Executed `npm dedupe` to flatten hoisted dependencies.
- Verified extraneous packages with `npm prune --dry-run` and removed them via `npm prune`.
- Reinstalled workspaces with `npm ci --workspaces` to ensure a clean node_modules tree.

## Root package.json
| Change | Details |
| --- | --- |
| Removed dev dependency | `@cap-js/cds-test` (only used by the service workspace; retained there). |
| Removed dev dependency | `@cap-js/sqlite` (service workspace owns the runtime requirement). |
| Shared tooling | `typescript` and `concurrently` remain in the root so both workspaces resolve them without duplication. |

## srv/package.json
| Change | Details |
| --- | --- |
| Removed dependency | `@sap/xssec` (unused by the refactored services and handlers). |
| Removed dependency | `typescript` (centralised at the root workspace). |
| Removed dev dependency | `concurrently` (now resolved from the root workspace). |
| Retained dev dependencies | Workspace-specific build/test tooling (`@cap-js/cds-test`, `@cap-js/sqlite`, Jest, ESLint, etc.) stay local to avoid leaking into other packages. |

## Result
- No missing dependencies reported by `tsc`, Jest, Playwright, or CAP CLI commands after the cleanup.
- Workspace installs complete via `npm ci --workspaces` with a single version of shared packages (e.g., `typescript@5.6.3`).
- `npm ls` reports no extraneous modules after pruning.
