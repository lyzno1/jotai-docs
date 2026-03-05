#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SYNCED_CATEGORIES = [
  'core',
  'basics',
  'guides',
  'recipes',
  'utilities',
  'extensions',
  'tools',
  'third-party',
]

function usage() {
  console.log(`Usage:
  node .agents/skills/jotai-zh-translation/scripts/i18n-init.mjs [options]

Options:
  --path=<relative-doc-path>   Add one source path. Repeatable.
  --from-status=<kind>         Select paths automatically: missing | stale (default: missing)
  --limit=<n>                  Limit auto-selected paths (default: 10)
  --force                      Overwrite existing zh files
  --dry-run                    Print actions without writing files
  --root=<path>                Repository root (default: cwd)
  --docs-root=<path>           Docs root relative to root (default: src/content/docs)
  --manifest=<path>            Manifest path relative to root (default: upstream/manifest.json)
  --metadata=<path>            Translation metadata path relative to root (default: upstream/i18n.zh.json)
  --locale=<name>              Locale directory (default: zh)
`)
}

function parseArgs(argv) {
  const options = {
    paths: [],
    fromStatus: null,
    limit: 10,
    force: false,
    dryRun: false,
    root: process.cwd(),
    docsRoot: 'src/content/docs',
    manifest: 'upstream/manifest.json',
    metadata: 'upstream/i18n.zh.json',
    locale: 'zh',
  }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg.startsWith('--path=')) {
      options.paths.push(arg.slice('--path='.length))
    } else if (arg.startsWith('--from-status=')) {
      options.fromStatus = arg.slice('--from-status='.length)
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number(arg.slice('--limit='.length))
    } else if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length)
    } else if (arg.startsWith('--docs-root=')) {
      options.docsRoot = arg.slice('--docs-root='.length)
    } else if (arg.startsWith('--manifest=')) {
      options.manifest = arg.slice('--manifest='.length)
    } else if (arg.startsWith('--metadata=')) {
      options.metadata = arg.slice('--metadata='.length)
    } else if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (
    options.fromStatus !== null &&
    options.fromStatus !== 'missing' &&
    options.fromStatus !== 'stale'
  ) {
    throw new Error('--from-status must be one of: missing, stale')
  }
  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error('--limit must be a positive integer')
  }
  return options
}

function resolveFromRoot(root, target) {
  return path.isAbsolute(target) ? target : path.join(root, target)
}

function isTrackedDocPath(docPath) {
  const firstSegment = docPath.split('/')[0]
  return SYNCED_CATEGORIES.includes(firstSegment)
}

function normalizeRelPath(input) {
  const unix = input.replace(/\\/g, '/').replace(/^\/+/, '')
  const normalized = path.posix.normalize(unix)
  if (
    normalized === '' ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    return null
  }
  return normalized
}

async function readJsonStrict(filePath) {
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content)
}

async function readJsonOptional(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback
  }
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content)
}

async function sha256File(filePath) {
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

function injectSourceComment(sourceContent, sourcePath, sourceRef, sourceHash) {
  const marker = `{/*
translation-source-path: ${sourcePath}
translation-source-ref: ${sourceRef}
translation-source-hash: ${sourceHash}
translation-status: draft
*/}`

  const frontmatterMatch = sourceContent.match(/^---\n[\s\S]*?\n---\n?/)
  if (!frontmatterMatch) {
    return `${marker}\n\n${sourceContent}`
  }

  const frontmatter = frontmatterMatch[0]
  const body = sourceContent.slice(frontmatter.length)
  return `${frontmatter}\n${marker}\n\n${body}`
}

async function collectAutoPaths({ manifestPath, metadataPath, docsRootPath, locale }) {
  const manifest = await readJsonStrict(manifestPath)
  const metadata = await readJsonOptional(metadataPath, { translations: {} })
  const translations =
    metadata && typeof metadata === 'object' && metadata.translations
      ? metadata.translations
      : {}

  const manifestFiles = (Array.isArray(manifest.files) ? manifest.files : [])
    .map((value) => normalizeRelPath(String(value)))
    .filter((value) => value && isTrackedDocPath(value))

  const missing = []
  const stale = []

  for (const relPath of manifestFiles) {
    const sourcePath = path.join(docsRootPath, relPath)
    const targetPath = path.join(docsRootPath, locale, relPath)

    if (!existsSync(sourcePath)) continue
    if (!existsSync(targetPath)) {
      missing.push(relPath)
      continue
    }

    const entry = translations[relPath]
    if (!entry || typeof entry !== 'object') {
      stale.push(relPath)
      continue
    }

    const currentHash = await sha256File(sourcePath)
    if (entry.hash !== currentHash || entry.sourceRef !== manifest.ref) {
      stale.push(relPath)
    }
  }

  return { manifest, missing, stale }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifestPath = resolveFromRoot(options.root, options.manifest)
  const metadataPath = resolveFromRoot(options.root, options.metadata)
  const docsRootPath = resolveFromRoot(options.root, options.docsRoot)
  const localeRootPath = path.join(docsRootPath, options.locale)

  const { manifest, missing, stale } = await collectAutoPaths({
    manifestPath,
    metadataPath,
    docsRootPath,
    locale: options.locale,
  })

  const manifestSet = new Set(
    (Array.isArray(manifest.files) ? manifest.files : [])
      .map((value) => normalizeRelPath(String(value)))
      .filter((value) => value),
  )

  const explicitPaths = options.paths
    .map((raw) => normalizeRelPath(raw))
    .filter((value) => value)
  const autoPaths =
    options.fromStatus === null
      ? []
      : options.fromStatus === 'stale'
        ? stale.slice(0, options.limit)
        : missing.slice(0, options.limit)

  const candidatePaths = [...explicitPaths, ...autoPaths]
  const deduped = []
  const seen = new Set()
  for (const relPath of candidatePaths) {
    if (seen.has(relPath)) continue
    seen.add(relPath)
    deduped.push(relPath)
  }

  if (deduped.length === 0) {
    throw new Error(
      'No paths selected. Use --path=<relative-path> or --from-status=missing|stale.',
    )
  }

  let created = 0
  let skipped = 0
  let invalid = 0

  for (const relPath of deduped) {
    if (!isTrackedDocPath(relPath)) {
      console.log(`[skip] ${relPath} (not in tracked docs scope)`)
      invalid += 1
      continue
    }
    if (!manifestSet.has(relPath)) {
      console.log(`[skip] ${relPath} (not found in manifest)`)
      invalid += 1
      continue
    }

    const sourcePath = path.join(docsRootPath, relPath)
    const targetPath = path.join(localeRootPath, relPath)
    if (!existsSync(sourcePath)) {
      console.log(`[skip] ${relPath} (source file missing)`)
      invalid += 1
      continue
    }

    const exists = existsSync(targetPath)
    if (exists && !options.force) {
      console.log(`[skip] ${relPath} (target exists, use --force to overwrite)`)
      skipped += 1
      continue
    }

    const sourceContent = await readFile(sourcePath, 'utf8')
    const sourceHash = await sha256File(sourcePath)
    const output = injectSourceComment(
      sourceContent,
      relPath,
      manifest.ref,
      sourceHash,
    )

    if (options.dryRun) {
      console.log(`[dry-run] ${exists ? 'overwrite' : 'create'} src/content/docs/${options.locale}/${relPath}`)
      created += 1
      continue
    }

    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, output, 'utf8')
    console.log(`[ok] ${exists ? 'overwrote' : 'created'} src/content/docs/${options.locale}/${relPath}`)
    created += 1
  }

  console.log('\nSummary')
  console.log(`  - selected: ${deduped.length}`)
  console.log(`  - created: ${created}`)
  console.log(`  - skipped: ${skipped}`)
  console.log(`  - invalid: ${invalid}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
