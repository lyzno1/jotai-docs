#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DOCS_ROOT = path.join(ROOT, 'src', 'content', 'docs')
const UPSTREAM_ROOT = path.join(ROOT, 'upstream')
const UPSTREAM_REPO = 'https://github.com/pmndrs/jotai.git'

const args = process.argv.slice(2)
const refArg = args.find((arg) => arg.startsWith('--ref='))
const requestedRef = refArg ? refArg.slice('--ref='.length) : undefined

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  })

  if (result.status !== 0) {
    const errorText = [
      `Command failed: ${command} ${commandArgs.join(' ')}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ]
      .filter(Boolean)
      .join('\n')
    throw new Error(errorText)
  }

  return result.stdout?.trim() ?? ''
}

function parseSemver(tag) {
  const trimmed = tag.startsWith('v') ? tag.slice(1) : tag
  const [major, minor, patch] = trimmed.split('.').map((part) => Number(part))
  if ([major, minor, patch].some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid semver tag: ${tag}`)
  }
  return { major, minor, patch }
}

function compareTagDesc(a, b) {
  const av = parseSemver(a)
  const bv = parseSemver(b)
  if (av.major !== bv.major) return bv.major - av.major
  if (av.minor !== bv.minor) return bv.minor - av.minor
  return bv.patch - av.patch
}

function latestTag() {
  const output = run('git', [
    'ls-remote',
    '--tags',
    '--refs',
    UPSTREAM_REPO,
    'refs/tags/v*',
  ])

  const tags = output
    .split('\n')
    .map((line) => line.split('\t')[1]?.replace('refs/tags/', ''))
    .filter((tag) => tag && /^v\d+\.\d+\.\d+$/.test(tag))

  if (!tags.length) {
    throw new Error('Unable to resolve any semver tags from upstream')
  }

  tags.sort(compareTagDesc)
  return tags[0]
}

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

function isTrackedDocPath(relPath) {
  const firstSegment = relPath.split('/')[0]
  return SYNCED_CATEGORIES.includes(firstSegment)
}

async function listMdxFiles(directory) {
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
      } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
        files.push(relative)
      }
    }
  }

  await walk(directory, '')
  files.sort()
  return files
}

async function ensureCleanSyncPaths() {
  for (const category of SYNCED_CATEGORIES) {
    await rm(path.join(DOCS_ROOT, category), { recursive: true, force: true })
  }
  await rm(path.join(DOCS_ROOT, 'index.mdx'), { force: true })
}

async function ensureFilesExist(filePaths) {
  const missing = []
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) {
      missing.push(filePath)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing expected files after sync:\n${missing
        .map((filePath) => ` - ${path.relative(ROOT, filePath)}`)
        .join('\n')}`,
    )
  }
}

function buildSyncStatusPage(lock) {
  return `---
title: Sync Status
description: Upstream synchronization metadata for this docs site.
---

This site tracks Jotai docs from the upstream repository.

- Upstream repo: [${lock.upstreamRepo}](${lock.upstreamRepo.replace('.git', '')})
- Current synced ref: \`${lock.ref}\`
- Upstream commit: \`${lock.commit}\`
- Synced at (UTC): \`${lock.syncedAt}\`

## Synced counts

- Total MDX files: ${lock.counts.totalMdx}
${SYNCED_CATEGORIES.map((cat) => `- ${cat}: ${lock.counts[cat] ?? 0}`).join('\n')}
`
}

async function main() {
  const resolvedRef = requestedRef ?? latestTag()
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'jotai-sync-'))
  const repoDir = path.join(tmpRoot, 'jotai')

  try {
    console.log(`Syncing Jotai docs from ${resolvedRef}...`)

    run(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--filter=blob:none',
        '--sparse',
        '--branch',
        resolvedRef,
        UPSTREAM_REPO,
        repoDir,
      ],
      { stdio: 'inherit' },
    )
    run('git', ['-C', repoDir, 'sparse-checkout', 'set', 'docs'], {
      stdio: 'inherit',
    })

    const upstreamCommit = run('git', ['-C', repoDir, 'rev-parse', 'HEAD'])
    const upstreamDocsDir = path.join(repoDir, 'docs')
    const upstreamFiles = await listMdxFiles(upstreamDocsDir)

    await ensureCleanSyncPaths()

    for (const relPath of upstreamFiles) {
      const source = path.join(upstreamDocsDir, relPath)
      const destination = path.join(DOCS_ROOT, relPath)
      await mkdir(path.dirname(destination), { recursive: true })
      await copyFile(source, destination)
    }

    const trackedFiles = upstreamFiles.filter((f) => isTrackedDocPath(f))

    const expectedPaths = trackedFiles.map((f) => path.join(DOCS_ROOT, f))
    await ensureFilesExist(expectedPaths)

    const counts = { totalMdx: trackedFiles.length }
    for (const cat of SYNCED_CATEGORIES) {
      counts[cat] = trackedFiles.filter((f) => f.startsWith(`${cat}/`)).length
    }

    const manifest = {
      syncedAt: new Date().toISOString(),
      ref: resolvedRef,
      files: trackedFiles,
    }

    await mkdir(UPSTREAM_ROOT, { recursive: true })
    await writeFile(
      path.join(UPSTREAM_ROOT, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    )

    const lock = {
      upstreamRepo: UPSTREAM_REPO,
      track: 'latest-tag',
      ref: resolvedRef,
      commit: upstreamCommit,
      syncedAt: new Date().toISOString(),
      counts,
    }

    await writeFile(
      path.join(UPSTREAM_ROOT, 'lock.json'),
      `${JSON.stringify(lock, null, 2)}\n`,
      'utf8',
    )

    await writeFile(
      path.join(DOCS_ROOT, 'sync-status.md'),
      buildSyncStatusPage(lock),
      'utf8',
    )

    console.log('Sync complete')
    console.log(` - Upstream ref: ${resolvedRef}`)
    console.log(` - Upstream commit: ${upstreamCommit}`)
    console.log(` - Synced MDX files: ${trackedFiles.length}`)
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
