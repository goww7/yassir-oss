# Contributing

Thanks for helping improve Yassir.

## Before you start

- Search [existing issues](https://github.com/goww7/yassir-oss/issues) to avoid duplicates.
- For larger changes, open an issue first so we can align on direction.

## Development setup

```bash
git clone https://github.com/goww7/yassir.git
cd yassir
bun install
cp env.example .env
```

Run checks before opening a PR:

```bash
bun run typecheck
bun test
```

## Pull requests

- Keep PRs **small and focused** (one concern per PR).
- Describe **what** changed and **why**.
- Update docs or examples if behavior visible to users changes.

## Code style

- Match existing patterns in the touched files (formatting, naming, error handling).
- Avoid unrelated refactors in the same PR as a feature or fix.
