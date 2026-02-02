# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds all TypeScript source.
  - `src/agent/` agent loop + system prompt.
  - `src/tools/` web + filesystem tool implementations.
  - `src/llm/` Ollama client wrapper.
  - `src/util/` shared utilities (sandboxing, logging, stats, markdown, STT).
  - `src/server/` remote server mode (SSE streaming).
- `tests/` contains Vitest unit tests.
- `dist/` is build output (checked in for CLI distribution).
- `workspace/` is the local sandbox root (ignored).
- `workspaces/` holds per-user remote sandboxes (ignored).
- `scripts/` contains helper scripts (e.g., `scripts/vosk_transcribe.py`).

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run build` compiles TypeScript to `dist/`.
- `npm test` runs Vitest test suite.
- `npm start -- chat` runs the local interactive CLI.
- `npm start -- serve --host 0.0.0.0 --port 8080 --token <token>` starts remote server mode.

## Coding Style & Naming Conventions
- TypeScript only, 2-space indentation.
- File names: `camelCase.ts` for utilities, feature folders are `kebab-case` if needed.
- Prefer explicit types for public interfaces and exported functions.
- No heavy formatting tools; keep code readable and consistent.

## Testing Guidelines
- Framework: Vitest.
- Test files live in `tests/` and use `*.test.ts`.
- Run tests with `npm test`.
- Add tests for sandboxing and patch behavior when changing file tools.

## Commit & Pull Request Guidelines
- Commit format: **Conventional Commits with required scope**  
  Example: `feat(cli): add remote server mode`
- Types: `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`
- Subject: imperative, ≤72 chars.
- PRs should include: purpose, key changes, testing performed, and any risks.

## Security & Configuration Tips
- The workspace is sandboxed to `./workspace` (local) or `./workspaces/<user>` (remote).
- For remote mode, always set `--token` to avoid open access.
- Web content is treated as untrusted data by the system prompt.
