# Contributing to Hermod

Thanks for helping. Hermod is licensed under Apache-2.0, and contributions are accepted under the same license.

## Setup

```bash
npm ci
npm run tauri dev
```

## Before you open a pull request

- `cargo fmt --all --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `npx tsc --noEmit -p .` and `npx eslint`
- `npx playwright test` for UI changes

## Guidelines

- docs/ARCHITECTURE.md is the contract. Change it first when you change behavior.
- Keep pull requests small and focused. Add tests for new logic.
- Never commit keys, tokens, or `.env` files.
- Changes to the terms or privacy text must bump the `version` in the file front-matter, so users are asked to accept again.
- Use conventional commit messages (`feat:`, `fix:`, `docs:`).
