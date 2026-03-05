#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
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
  node scripts/i18n-status.mjs [options]

Options:
  --root=<path>        Repository root (default: cwd)
  --docs-root=<path>   Docs root relative to root (default: src/content/docs)
  --manifest=<path>    Manifest path relative to root (default: upstream/manifest.json)
  --metadata=<path>    Translation metadata path relative to root (default: upstream/i18n.zh.json)
  --locale=<name>      Locale directory (default: zh)
  --limit=<n>          Max entries per section in text output (default: 20)
  --json               Print JSON output
`)
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    docsRoot: 'src/content/docs',
    manifest: 'upstream/manifest.json',
    metadata: 'upstream/i18n.zh.json',
    locale: 'zh',
    limit: 20,
    json: false,
  }

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else if (arg === '--json') {
      options.json = true
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
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number(arg.slice('--limit='.length))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
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

async function listMarkdownFiles(directory) {
  const files = []
  if (!existsSync(directory)) return files

  async function walk(currentDir, prefix) {
    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const absolute = path.join(currentDir, entry.name)
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        await walk(absolute, relative)
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
          files.push(relative)
        }
      }
    }
  }

  await walk(directory, '')
  files.sort()
  return files
}

async function sha256File(filePath) {
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

async function computeStatus(options) {
  const manifestPath = resolveFromRoot(options.root, options.manifest)
  const metadataPath = resolveFromRoot(options.root, options.metadata)
  const docsRootPath = resolveFromRoot(options.root, options.docsRoot)
  const localeRootPath = path.join(docsRootPath, options.locale)

  const manifest = await readJsonStrict(manifestPath)
  if (!Array.isArray(manifest.files) || typeof manifest.ref !== 'string') {
    throw new Error(
      `Invalid manifest format in ${manifestPath}. Expected keys: ref (string), files (string[]).`,
    )
  }

  const metadata = await readJsonOptional(metadataPath, {
    locale: options.locale,
    sourceRef: manifest.ref,
    translations: {},
  })
  const translations =
    metadata && typeof metadata === 'object' && metadata.translations
      ? metadata.translations
      : {}

  const sourceMissing = []
  const missing = []
  const stale = []
  const upToDate = []

  const manifestFiles = manifest.files
    .map((raw) => normalizeRelPath(String(raw)))
    .filter((value) => value && isTrackedDocPath(value))

  const manifestSet = new Set(manifestFiles)

  for (const relPath of manifestFiles) {
    const sourcePath = path.join(docsRootPath, relPath)
    const zhPath = path.join(localeRootPath, relPath)

    if (!existsSync(sourcePath)) {
      sourceMissing.push(relPath)
      continue
    }

    if (!existsSync(zhPath)) {
      missing.push(relPath)
      continue
    }

    const currentHash = await sha256File(sourcePath)
    const entry = translations[relPath]

    if (!entry || typeof entry !== 'object') {
      stale.push({ path: relPath, reason: 'metadata-missing' })
      continue
    }

    if (entry.hash !== currentHash) {
      stale.push({ path: relPath, reason: 'source-hash-mismatch' })
      continue
    }

    if (entry.sourceRef !== manifest.ref) {
      stale.push({ path: relPath, reason: 'source-ref-mismatch' })
      continue
    }

    upToDate.push(relPath)
  }

  const zhTrackedFiles = (await listMarkdownFiles(localeRootPath)).filter(
    (file) => isTrackedDocPath(file),
  )
  const orphanZh = zhTrackedFiles.filter((relPath) => !manifestSet.has(relPath))

  const metadataWithoutPage = Object.keys(translations)
    .map((raw) => normalizeRelPath(String(raw)))
    .filter((value) => value && isTrackedDocPath(value))
    .filter((relPath) => !existsSync(path.join(localeRootPath, relPath)))

  return {
    manifestRef: manifest.ref,
    locale: options.locale,
    paths: {
      manifest: path.relative(options.root, manifestPath),
      metadata: path.relative(options.root, metadataPath),
      docsRoot: path.relative(options.root, docsRootPath),
    },
    counts: {
      sourceTracked: manifestFiles.length,
      missing: missing.length,
      stale: stale.length,
      upToDate: upToDate.length,
      sourceMissing: sourceMissing.length,
      orphanZh: orphanZh.length,
      metadataWithoutPage: metadataWithoutPage.length,
    },
    lists: {
      sourceMissing,
      missing,
      stale,
      upToDate,
      orphanZh,
      metadataWithoutPage,
    },
  }
}

function printList(label, values, limit, formatter = (value) => value) {
  if (values.length === 0) return
  console.log(`\n${label} (${values.length})`)
  for (const value of values.slice(0, limit)) {
    console.log(`  - ${formatter(value)}`)
  }
  if (values.length > limit) {
    console.log(`  ... and ${values.length - limit} more`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const status = await computeStatus(options)

  if (options.json) {
    console.log(JSON.stringify(status, null, 2))
  } else {
    console.log(`Manifest ref: ${status.manifestRef}`)
    console.log(`Locale: ${status.locale}`)
    console.log(`Manifest: ${status.paths.manifest}`)
    console.log(`Metadata: ${status.paths.metadata}`)
    console.log(`Docs root: ${status.paths.docsRoot}`)

    console.log('\nCounts')
    for (const [key, value] of Object.entries(status.counts)) {
      console.log(`  - ${key}: ${value}`)
    }

    printList('Missing translations', status.lists.missing, options.limit)
    printList('Stale translations', status.lists.stale, options.limit, (item) => {
      return `${item.path} (${item.reason})`
    })
    printList('Orphan zh pages', status.lists.orphanZh, options.limit)
    printList(
      'Metadata entries without page',
      status.lists.metadataWithoutPage,
      options.limit,
    )
    printList('Missing source pages', status.lists.sourceMissing, options.limit)
  }

  if (status.counts.sourceMissing > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
