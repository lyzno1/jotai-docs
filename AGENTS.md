# Repository Guidelines

## Project Structure & Module Organization
- `src/content/docs/`: synchronized Jotai docs used by Starlight.
- `src/styles/theme.css`: site-level theme overrides.
- `public/`: static assets (for example, `favicon.svg`).
- `scripts/`: sync and i18n automation scripts:
  - `sync-jotai-docs.mjs` pulls upstream docs and updates metadata.
  - `check-upstream-update.mjs` checks whether a newer upstream tag exists.
  - `i18n-status.mjs` computes translation status per file (hash-based).
  - `check-i18n-status.mjs` wrapper that exits non-zero on translation gaps.
- `upstream/`: sync state (`lock.json`, `manifest.json`).
- `.github/workflows/`: CI checks and scheduled sync PR automation.

## Build, Test, and Development Commands
- `pnpm install --frozen-lockfile`: install dependencies exactly as locked.
- `pnpm run dev`: start local Astro/Starlight dev server.
- `pnpm run check`: run Astro content and type validation.
- `pnpm run lint`: run ESLint with zero-warning policy.
- `pnpm run build`: produce the static site in `dist/`.
- `pnpm run preview`: preview the production build locally.
- `pnpm run sync:check`: fail if a newer upstream tag is available.
- `pnpm run sync:docs -- --ref=vX.Y.Z`: sync docs from latest or pinned upstream tag.
- `pnpm run i18n:check`: fail if translation integrity issues exist.

## Coding Style & Naming Conventions
- Use ESM scripts (`.mjs`) and prefer explicit `node:*` imports.
- Follow existing formatting; avoid formatting-only churn.
- Preserve upstream file names and paths for synchronized docs.
- For project-authored docs, include clear frontmatter (`title`, `description`).

## Testing Guidelines
- No dedicated unit-test suite; validation is build/check based.
- Before opening a PR, run: `pnpm run check` and `pnpm run build`.
- For sync changes, also run `pnpm run sync:docs` and verify updates in:
  - `upstream/lock.json`
  - `upstream/manifest.json`
  - `src/content/docs/sync-status.md`

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat:`, `fix:`, `chore:`), consistent with repo history.
- For upstream refreshes, use: `chore: sync Jotai docs`.
- PRs should include a concise summary, tracked upstream ref (`upstream/lock.json`), and confirmation that `check` + `build` passed.

## Configuration Tips
- Set `SITE_URL` for production builds; otherwise Astro defaults to `https://example.com`.
