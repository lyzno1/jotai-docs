#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const STATUS_SCRIPT = path.join(ROOT, 'scripts', 'i18n-status.mjs')

const FAIL_KEYS = [
  'sourceMissing',
  'orphanZh',
  'metadataWithoutPage',
]

const WARN_KEYS = [
  'missing',
  'stale',
]

function runStatusJson() {
  const result = spawnSync(process.execPath, [STATUS_SCRIPT, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  })

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || 'i18n-status failed')
  }

  return JSON.parse(result.stdout)
}

function formatList(status, key) {
  const values = status?.lists?.[key] ?? []
  if (!Array.isArray(values) || values.length === 0) return null

  const preview = values.slice(0, 10).map((entry) => {
    if (entry && typeof entry === 'object') {
      return `  - ${entry.path ?? JSON.stringify(entry)}`
    }
    return `  - ${String(entry)}`
  })

  return [`${key}: ${values.length}`, ...preview].join('\n')
}

function main() {
  const status = runStatusJson()
  const counts = status?.counts ?? {}

  const failures = FAIL_KEYS
    .map((key) => ({ key, count: Number(counts[key] ?? 0) }))
    .filter((item) => item.count > 0)

  const warnings = WARN_KEYS
    .map((key) => ({ key, count: Number(counts[key] ?? 0) }))
    .filter((item) => item.count > 0)

  if (warnings.length > 0) {
    console.log(`i18n translation progress: upToDate=${counts.upToDate ?? 0}, missing=${counts.missing ?? 0}, stale=${counts.stale ?? 0}`)
  }

  if (failures.length === 0) {
    console.log(
      `i18n check passed: orphanZh=0, sourceMissing=0, metadataWithoutPage=0`,
    )
    return
  }

  console.error('i18n check failed.')
  console.error(`manifestRef=${status.manifestRef}, locale=${status.locale}`)
  for (const item of failures) {
    const details = formatList(status, item.key)
    if (details) console.error(details)
  }
  process.exit(1)
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
