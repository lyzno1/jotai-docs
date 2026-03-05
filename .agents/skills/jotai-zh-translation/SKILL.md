---
name: jotai-zh-translation
description: Manage the Jotai docs bilingual workflow in this repository. Use when syncing upstream English docs, planning manual Chinese translation, checking missing/stale translation pages, creating zh translation drafts, or verifying translation metadata before CI/PR.
---

# Jotai ZH Translation

## Overview

Track English upstream changes and keep `zh` translation pages maintainable with deterministic scripts.
Use this skill to run the full cycle: detect changes, create translation drafts, and verify metadata consistency.

## Workflow

1. Sync upstream English docs first (`pnpm run sync:docs`).
2. Run status script to get `missing` and `stale` lists.
3. Create translation draft files for selected pages.
4. Translate manually.
5. Refresh and validate metadata.
6. Run `pnpm run check` and `pnpm run build` before PR.

## Script Entry Points

- Status
  - `node .agents/skills/jotai-zh-translation/scripts/i18n-status.mjs`
  - Output counts and lists: `missing`, `stale`, `upToDate`, `orphans`.

- Init draft files
  - `node .agents/skills/jotai-zh-translation/scripts/i18n-init.mjs --path core/atom.mdx`
  - `node .agents/skills/jotai-zh-translation/scripts/i18n-init.mjs --from-status missing --limit 10`
  - Insert source metadata comment and copy upstream content to `src/content/docs/zh/...`.

- Verify or write metadata
  - `node .agents/skills/jotai-zh-translation/scripts/i18n-verify.mjs`
  - `node .agents/skills/jotai-zh-translation/scripts/i18n-verify.mjs --write`
  - Maintain `upstream/i18n.zh.json` based on current upstream ref and source hashes.

## Metadata Contract

Use `upstream/i18n.zh.json` as the only translation metadata source.

Each entry key is an upstream-relative path from `upstream/manifest.json` (example: `core/atom.mdx`).

Shape:

```json
{
  "locale": "zh",
  "sourceRef": "v2.18.0",
  "generatedAt": "2026-03-05T00:00:00.000Z",
  "translations": {
    "core/atom.mdx": {
      "hash": "sha256-of-source-file",
      "sourceRef": "v2.18.0",
      "translatedAt": "2026-03-05T00:00:00.000Z"
    }
  }
}
```

## Scope Rules

- Treat upstream synchronized paths as source of truth:
  - `core/**`
  - `basics/**`
  - `guides/**`
  - `recipes/**`
  - `utilities/**`
  - `extensions/**`
  - `tools/**`
  - `third-party/**`
- Do not use frontmatter custom fields for translation metadata unless docs schema is extended.
- Keep translation state in sidecar JSON (`upstream/i18n.zh.json`) to avoid schema coupling.
- Avoid editing files under synced category directories manually; these are overwritten by sync script.

## References

- Translation style: `references/translation-style.md`
- Terminology baseline: `references/terminology.md`

## PR Checklist

1. Run `pnpm run sync:docs` if upstream changed.
2. Run status script and choose translation batch.
3. Translate pages in `src/content/docs/zh/...`.
4. Run `i18n-verify.mjs --write`.
5. Run `pnpm run check`.
6. Run `pnpm run build`.
7. Include translated page list in PR body.

## Troubleshooting

- `stale` grows after sync
  - Expected. Upstream source hash changed. Re-translate affected pages.
- `orphanZh` appears
  - Upstream removed/renamed source page. Move, remove, or re-map zh file.
- `metadataWithoutPage` appears
  - Run `i18n-verify.mjs --write` to prune stale metadata entries.
