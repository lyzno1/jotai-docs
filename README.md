# Jotai Docs

Unofficial Jotai documentation site with Chinese translation and automated upstream synchronization.

**Live site:** https://jotai-docs.vercel.app

## Features

- Synced from [pmndrs/jotai](https://github.com/pmndrs/jotai) (currently tracking **v2.18.0**)
- Chinese (zh-CN) translation with hash-based staleness detection
- Automated upstream sync via GitHub Actions
- Built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build)

## Getting Started

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start local dev server |
| `pnpm run build` | Build static site to `dist/` |
| `pnpm run check` | Astro content & type validation |
| `pnpm run lint` | ESLint with zero-warning policy |
| `pnpm run sync:docs` | Sync docs from upstream Jotai repo |
| `pnpm run sync:check` | Check if a newer upstream tag exists |
| `pnpm run i18n:check` | Verify translation integrity |

## Project Structure

```
src/content/docs/       # English docs (synced from upstream)
src/content/docs/zh/    # Chinese translations
src/styles/theme.css    # Site-level theme overrides
scripts/                # Sync & i18n automation
upstream/               # Sync state (lock.json, manifest.json)
.github/workflows/      # CI checks & scheduled sync
```

## Deployment

Deployed on [Vercel](https://vercel.com). Pushes to `main` trigger automatic production builds.

Environment variable: `SITE_URL=https://jotai-docs.vercel.app`

## License

Documentation content is from [Jotai](https://github.com/pmndrs/jotai) by Poimandres. Site infrastructure is MIT.
