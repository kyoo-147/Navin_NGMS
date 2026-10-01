import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const INDEX_VERSION = 1
export const HASH_ALGORITHM = 'sha256'

const SHA256_PATTERN = /^[a-f0-9]{64}$/

export class IndexError extends Error {
  constructor(message, { code = 'INDEX_UNSAFE_PATH', path: unsafePath = null } = {}) {
    super(message)
    this.name = 'IndexError'
    this.code = code
    this.path = unsafePath
  }
}

export function sha256Hex(input) {
  const hash = createHash(HASH_ALGORITHM)
  hash.update(input)
  return hash.digest('hex')
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value))
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue)
  }
  if (value && typeof value === 'object') {
    const output = {}
    for (const key of Object.keys(value).sort()) {
      output[key] = sortValue(value[key])
    }
    return output
  }
  return value
}

export function sha256Json(value) {
  return sha256Hex(stableStringify(value))
}

export function sha256File(filePath) {
  return sha256Hex(fs.readFileSync(filePath))
}

export function toPosix(relativePath) {
  return String(relativePath).split(path.sep).join('/')
}

/**
 * Normalizes a bundle-relative path and rejects anything that could escape the
 * bundle: absolute paths, drive/UNC prefixes, NUL bytes, `..` traversal and
 * empty results. Mixed separators (`\` and `/`) are collapsed to POSIX.
 * Returns the normalized relative path, or null when the input is unsafe.
 */
export function normalizeEntryPath(entryPath) {
  if (typeof entryPath !== 'string' || entryPath.length === 0) {
    return null
  }
  if (entryPath.includes('\0')) {
    return null
  }
  const posix = entryPath.split('\\').join('/')
  if (posix.startsWith('/')) {
    return null
  }
  if (/^[A-Za-z]:/.test(posix)) {
    return null
  }
  const segments = []
  for (const segment of posix.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      return null
    }
    segments.push(segment)
  }
  if (segments.length === 0) {
    return null
  }
  return segments.join('/')
}

export function isSafeRelativePath(entryPath) {
  return normalizeEntryPath(entryPath) !== null
}

/**
 * Resolves a bundle-relative path against a root directory, rejecting anything
 * that lexically escapes the root. Returns { normalized, absolute } or null.
 */
export function resolveInsideRoot(rootDir, entryPath) {
  const normalized = normalizeEntryPath(entryPath)
  if (normalized === null) {
    return null
  }
  const rootResolved = path.resolve(rootDir)
  const absolute = path.resolve(rootResolved, normalized)
  const rootWithSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep
  if (absolute !== rootResolved && !absolute.startsWith(rootWithSep)) {
    return null
  }
  return { normalized, absolute }
}

function realpathInside(rootReal, absolutePath) {
  let real
  try {
    real = fs.realpathSync(absolutePath)
  } catch {
    return null
  }
  const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep
  if (real !== rootReal && !real.startsWith(rootWithSep)) {
    return null
  }
  return real
}

export function buildIndex(rootDir, relativePaths, { createdAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(relativePaths)) {
    throw new IndexError('buildIndex requires an array of relative paths', {
      code: 'INDEX_BAD_INPUT',
    })
  }
  const rootReal = fs.realpathSync(rootDir)
  const seen = new Set()
  const normalizedPaths = []
  for (const rawPath of relativePaths) {
    const normalized = normalizeEntryPath(rawPath)
    if (normalized === null) {
      throw new IndexError(`unsafe bundle path: ${JSON.stringify(rawPath)}`, {
        code: 'INDEX_UNSAFE_PATH',
        path: String(rawPath),
      })
    }
    if (seen.has(normalized)) {
      throw new IndexError(`duplicate bundle path: ${normalized}`, {
        code: 'INDEX_DUPLICATE_PATH',
        path: normalized,
      })
    }
    seen.add(normalized)
    normalizedPaths.push(normalized)
  }

  const entries = normalizedPaths.sort().map((relativePath) => {
    const resolved = resolveInsideRoot(rootReal, relativePath)
    if (!resolved) {
      throw new IndexError(`path escapes bundle root: ${relativePath}`, {
        code: 'INDEX_UNSAFE_PATH',
        path: relativePath,
      })
    }
    const real = realpathInside(rootReal, resolved.absolute)
    if (!real) {
      throw new IndexError(`path escapes bundle root via symlink: ${relativePath}`, {
        code: 'INDEX_SYMLINK_ESCAPE',
        path: relativePath,
      })
    }
    const buffer = fs.readFileSync(real)
    return {
      path: relativePath,
      bytes: buffer.length,
      sha256: sha256Hex(buffer),
    }
  })

  return {
    indexVersion: INDEX_VERSION,
    algorithm: HASH_ALGORITHM,
    createdAt,
    entryCount: entries.length,
    entries,
    indexSha256: sha256Json(entries),
  }
}

function validateEntryShape(entry, index, errors) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push({ type: 'malformed-entry', index, reason: 'entry must be an object' })
    return false
  }
  if (typeof entry.path !== 'string' || entry.path.length === 0) {
    errors.push({ type: 'malformed-entry', index, reason: 'path must be a non-empty string' })
    return false
  }
  if (!Number.isInteger(entry.bytes) || entry.bytes < 0) {
    errors.push({ type: 'malformed-entry', index, reason: 'bytes must be a non-negative integer' })
    return false
  }
  if (typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) {
    errors.push({ type: 'malformed-entry', index, reason: 'sha256 must be 64 lowercase hex chars' })
    return false
  }
  return true
}

export function verifyIndex(rootDir, index) {
  const errors = []
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    return { ok: false, checked: 0, errors: [{ type: 'missing-index' }] }
  }
  if (index.algorithm !== HASH_ALGORITHM) {
    errors.push({
      type: 'algorithm-mismatch',
      expected: HASH_ALGORITHM,
      actual: index.algorithm ?? null,
    })
  }
  if (!Array.isArray(index.entries)) {
    errors.push({ type: 'malformed-index', reason: 'entries must be an array' })
    return { ok: false, checked: 0, errors }
  }
  if (index.indexVersion !== INDEX_VERSION) {
    errors.push({
      type: 'unsupported-index-version',
      expected: INDEX_VERSION,
      actual: index.indexVersion ?? null,
    })
  }
  if (index.entryCount !== index.entries.length) {
    errors.push({
      type: 'entry-count-mismatch',
      expected: index.entryCount ?? null,
      actual: index.entries.length,
    })
  }

  const expectedIndexHash = sha256Json(index.entries)
  if (expectedIndexHash !== index.indexSha256) {
    errors.push({
      type: 'index-integrity',
      expected: expectedIndexHash,
      actual: index.indexSha256 ?? null,
    })
  }

  let rootReal
  try {
    rootReal = fs.realpathSync(rootDir)
  } catch {
    return { ok: false, checked: 0, errors: [...errors, { type: 'missing-root', path: rootDir }] }
  }

  const seen = new Set()
  let previousPath = null
  let checked = 0
  for (let position = 0; position < index.entries.length; position += 1) {
    const entry = index.entries[position]
    if (!validateEntryShape(entry, position, errors)) {
      continue
    }
    checked += 1
    const normalized = normalizeEntryPath(entry.path)
    if (normalized === null) {
      errors.push({ type: 'unsafe-path', path: entry.path })
      continue
    }
    if (normalized !== entry.path) {
      errors.push({ type: 'non-canonical-path', path: entry.path, normalized })
    }
    if (previousPath !== null && normalized <= previousPath) {
      errors.push({ type: 'unsorted-entries', path: normalized, previous: previousPath })
    }
    previousPath = normalized
    if (seen.has(normalized)) {
      errors.push({ type: 'duplicate-entry', path: normalized })
      continue
    }
    seen.add(normalized)

    const resolved = resolveInsideRoot(rootReal, normalized)
    if (!resolved) {
      errors.push({ type: 'unsafe-path', path: normalized })
      continue
    }
    if (!fs.existsSync(resolved.absolute)) {
      errors.push({ type: 'missing-file', path: normalized })
      continue
    }
    const real = realpathInside(rootReal, resolved.absolute)
    if (!real) {
      errors.push({ type: 'symlink-escape', path: normalized })
      continue
    }
    const actual = sha256Hex(fs.readFileSync(real))
    if (actual !== entry.sha256) {
      errors.push({ type: 'hash-mismatch', path: normalized, expected: entry.sha256, actual })
    }
  }
  return { ok: errors.length === 0, checked, errors }
}
