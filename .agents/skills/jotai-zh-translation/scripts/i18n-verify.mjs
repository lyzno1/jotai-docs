#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
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
  node .agents/skills/jotai-zh-translation/scripts/i18n-verify.mjs [options]

Options:
  --write               Write/update upstream/i18n.zh.json from current zh pages
  --dry-run             Print write actions without writing files
  --json                Print JSON result
  --root=<path>         Repository root (default: cwd)
  --docs-root=<path>    Docs root relative to root (default: src/content/docs)
  --manifest=<path>     Manifest path relative to root (default: upstream/manifest.json)
  --metadata=<path>     Translation metadata path relative to root (default: upstream/i18n.zh.json)
  --locale=<name>       Locale directory (default: zh)
`)
}

function parseArgs(argv) {
  const options = {
    write: false,
    dryRun: false,
    json: false,
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
    } else if (arg === '--write') {
      options.write = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
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
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function resolveFromRoot(root, target) {
  return path.isAbsolute(target) ? target : path.join(root, target)
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

function isTrackedDocPath(docPath) {
  const firstSegment = docPath.split('/')[0]
  return SYNCED_CATEGORIES.includes(firstSegment)
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
  if (!existsSync(directory)) {
    return files
  }

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

function sortObjectByKey(input) {
  const keys = Object.keys(input).sort()
  const output = {}
  for (const key of keys) {
    output[key] = input[key]
  }
  return output
}

async function analyze(options) {
  const manifestPath = resolveFromRoot(options.root, options.manifest)
  const metadataPath = resolveFromRoot(options.root, options.metadata)
  const docsRootPath = resolveFromRoot(options.root, options.docsRoot)
  const localeRootPath = path.join(docsRootPath, options.locale)

  const manifest = await readJsonStrict(manifestPath)
  if (!Array.isArray(manifest.files) || typeof manifest.ref !== 'string') {
    throw new TypeError(
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

  const manifestFiles = manifest.files
    .map((value) => normalizeRelPath(String(value)))
    .filter((value) => value && isTrackedDocPath(value))
  const manifestSet = new Set(manifestFiles)

  const zhFiles = (await listMarkdownFiles(localeRootPath)).filter((file) =>
    isTrackedDocPath(file),
  )
  const zhSet = new Set(zhFiles)

  const orphanZh = []
  const sourceMissing = []
  const missingMetadata = []
  const staleMetadata = []
  const valid = []
  const currentHashes = {}

  for (const relPath of zhFiles) {
    if (!manifestSet.has(relPath)) {
      orphanZh.push(relPath)
      continue
    }

    const sourcePath = path.join(docsRootPath, relPath)
    if (!existsSync(sourcePath)) {
      sourceMissing.push(relPath)
      continue
    }

    const hash = await sha256File(sourcePath)
    currentHashes[relPath] = hash
    const entry = translations[relPath]
    if (!entry || typeof entry !== 'object') {
      missingMetadata.push(relPath)
      continue
    }

    if (entry.hash !== hash || entry.sourceRef !== manifest.ref) {
      staleMetadata.push({
        path: relPath,
        expectedHash: hash,
        actualHash: entry.hash ?? null,
        expectedRef: manifest.ref,
        actualRef: entry.sourceRef ?? null,
      })
      continue
    }

    valid.push(relPath)
  }

  const metadataWithoutPage = Object.keys(translations)
    .map((value) => normalizeRelPath(String(value)))
    .filter((value) => value && isTrackedDocPath(value))
    .filter((relPath) => !zhSet.has(relPath))

  return {
    manifestRef: manifest.ref,
    locale: options.locale,
    paths: {
      manifest: path.relative(options.root, manifestPath),
      metadata: path.relative(options.root, metadataPath),
      docsRoot: path.relative(options.root, docsRootPath),
    },
    metadataPath,
    metadata,
    translations,
    currentHashes,
    zhFiles,
    orphanZh,
    sourceMissing,
    missingMetadata,
    staleMetadata,
    metadataWithoutPage,
    valid,
  }
}

async function writeMetadata(result, options) {
  const now = new Date().toISOString()
  const nextTranslations = {}
  let updated = 0
  let unchanged = 0

  for (const relPath of result.zhFiles) {
    if (!result.currentHashes[relPath]) continue
    const existing = result.translations[relPath]
    const hash = result.currentHashes[relPath]
    const isUnchanged =
      existing &&
      existing.hash === hash &&
      existing.sourceRef === result.manifestRef &&
      typeof existing.translatedAt === 'string'

    nextTranslations[relPath] = {
      hash,
      sourceRef: result.manifestRef,
      translatedAt: isUnchanged ? existing.translatedAt : now,
    }

    if (isUnchanged) unchanged += 1
    else updated += 1
  }

  const payload = {
    locale: options.locale,
    sourceRef: result.manifestRef,
    generatedAt: now,
    translations: sortObjectByKey(nextTranslations),
  }

  const removed = Object.keys(result.translations).filter(
    (key) => !(key in nextTranslations),
  ).length

  if (options.dryRun) {
    return { payload, updated, unchanged, removed, wrote: false }
  }

  await mkdir(path.dirname(result.metadataPath), { recursive: true })
  await writeFile(result.metadataPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { payload, updated, unchanged, removed, wrote: true }
}

function printText(result, writeResult) {
  console.log(`Manifest ref: ${result.manifestRef}`)
  console.log(`Locale: ${result.locale}`)
  console.log(`Tracked zh pages: ${result.zhFiles.length}`)
  console.log(`Valid metadata: ${result.valid.length}`)
  console.log(`Missing metadata: ${result.missingMetadata.length}`)
  console.log(`Stale metadata: ${result.staleMetadata.length}`)
  console.log(`Orphan zh pages: ${result.orphanZh.length}`)
  console.log(`Metadata without page: ${result.metadataWithoutPage.length}`)
  console.log(`Missing source pages: ${result.sourceMissing.length}`)

  const printList = (label, list, formatter = (item) => item) => {
    if (list.length === 0) return
    console.log(`\n${label}`)
    for (const item of list) {
      console.log(`  - ${formatter(item)}`)
    }
  }

  printList('Missing metadata', result.missingMetadata)
  printList('Stale metadata', result.staleMetadata, (item) => item.path)
  printList('Orphan zh pages', result.orphanZh)
  printList('Metadata without page', result.metadataWithoutPage)
  printList('Missing source pages', result.sourceMissing)

  if (writeResult) {
    console.log('\nWrite result')
    console.log(`  - wrote: ${writeResult.wrote}`)
    console.log(`  - updated: ${writeResult.updated}`)
    console.log(`  - unchanged: ${writeResult.unchanged}`)
    console.log(`  - removed: ${writeResult.removed}`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const result = await analyze(options)

  let writeResult = null
  if (options.write) {
    writeResult = await writeMetadata(result, options)
  }

  const output = {
    manifestRef: result.manifestRef,
    locale: result.locale,
    counts: {
      trackedZhPages: result.zhFiles.length,
      valid: result.valid.length,
      missingMetadata: result.missingMetadata.length,
      staleMetadata: result.staleMetadata.length,
      orphanZh: result.orphanZh.length,
      metadataWithoutPage: result.metadataWithoutPage.length,
      sourceMissing: result.sourceMissing.length,
    },
    lists: {
      missingMetadata: result.missingMetadata,
      staleMetadata: result.staleMetadata,
      orphanZh: result.orphanZh,
      metadataWithoutPage: result.metadataWithoutPage,
      sourceMissing: result.sourceMissing,
    },
    write: writeResult
      ? {
          wrote: writeResult.wrote,
          updated: writeResult.updated,
          unchanged: writeResult.unchanged,
          removed: writeResult.removed,
        }
      : null,
  }

  if (options.json) {
    console.log(JSON.stringify(output, null, 2))
  } else {
    printText(result, writeResult)
  }

  const readModeErrors =
    result.orphanZh.length > 0 ||
    result.sourceMissing.length > 0 ||
    result.missingMetadata.length > 0 ||
    result.staleMetadata.length > 0 ||
    result.metadataWithoutPage.length > 0
  const writeModeErrors = result.orphanZh.length > 0 || result.sourceMissing.length > 0

  if (options.write) {
    if (writeModeErrors) process.exit(1)
    return
  }

  if (readModeErrors) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
