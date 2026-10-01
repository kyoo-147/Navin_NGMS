import fs from 'node:fs'
import path from 'node:path'
import { buildIndex, normalizeEntryPath, sha256Hex, toPosix, verifyIndex } from './hashes.mjs'

export function sanitizeSegment(name) {
  return (
    String(name ?? 'unnamed')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'unnamed'
  )
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function collectFiles(root, dir, acc = []) {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      collectFiles(root, absolute, acc)
    } else {
      acc.push(toPosix(path.relative(root, absolute)))
    }
  }
  return acc
}

export function writeBundle(run, manifest, { outDir = 'out' } = {}) {
  const bundleDir = path.join(outDir, run.runId)
  const receiptsDir = path.join(bundleDir, 'receipts')
  fs.mkdirSync(receiptsDir, { recursive: true })

  writeJson(path.join(bundleDir, 'manifest.json'), manifest)
  writeJson(path.join(bundleDir, 'run.json'), run)

  run.receipts.forEach((receipt, index) => {
    const fileName = `${String(index + 1).padStart(3, '0')}_${sanitizeSegment(receipt.kind)}_${sanitizeSegment(receipt.receiptId)}.json`
    writeJson(path.join(receiptsDir, fileName), receipt)
  })

  const indexedFiles = collectFiles(bundleDir, bundleDir)
  const index = buildIndex(bundleDir, indexedFiles)
  writeJson(path.join(bundleDir, 'index.json'), index)
  const indexBytes = fs.readFileSync(path.join(bundleDir, 'index.json'))
  const indexSha256 = sha256Hex(indexBytes)
  fs.writeFileSync(path.join(bundleDir, 'index.sha256'), `${indexSha256}  index.json\n`, 'utf8')

  return { bundleDir, index, indexSha256, files: indexedFiles }
}

export function verifyBundle(bundleDir) {
  const indexPath = path.join(bundleDir, 'index.json')
  const shaPath = path.join(bundleDir, 'index.sha256')
  if (!fs.existsSync(indexPath)) {
    return { ok: false, checked: 0, errors: [{ type: 'missing-index', path: 'index.json' }] }
  }
  if (!fs.existsSync(shaPath)) {
    return { ok: false, checked: 0, errors: [{ type: 'missing-index-sha', path: 'index.sha256' }] }
  }
  const errors = []
  const recorded = fs.readFileSync(shaPath, 'utf8').trim().split(/\s+/)[0]
  const actual = sha256Hex(fs.readFileSync(indexPath))
  if (recorded !== actual) {
    errors.push({ type: 'index-sha-mismatch', expected: recorded, actual })
  }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  } catch (error) {
    errors.push({ type: 'index-parse', message: error.message })
    return { ok: false, checked: 0, errors }
  }
  const verified = verifyIndex(bundleDir, parsed)
  errors.push(...verified.errors)

  const indexed = new Set(
    (parsed.entries ?? [])
      .map((entry) =>
        entry && typeof entry.path === 'string' ? normalizeEntryPath(entry.path) : null,
      )
      .filter(Boolean),
  )
  const present = collectFiles(bundleDir, bundleDir).filter(
    (relativePath) => relativePath !== 'index.json' && relativePath !== 'index.sha256',
  )
  const presentSet = new Set(present)
  for (const relativePath of present) {
    if (!indexed.has(relativePath)) {
      errors.push({ type: 'unindexed-file', path: relativePath })
    }
  }
  for (const relativePath of indexed) {
    if (!presentSet.has(relativePath)) {
      errors.push({ type: 'missing-from-bundle', path: relativePath })
    }
  }

  return { ok: errors.length === 0, checked: verified.checked, errors }
}
