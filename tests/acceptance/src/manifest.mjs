import fs from 'node:fs'
import { assertEvidenceClass } from './classes.mjs'
import { candidateTokens } from './guard.mjs'
import { sha256Json } from './hashes.mjs'

export const MANIFEST_VERSION = 1

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

export class ManifestError extends Error {
  constructor(errors) {
    super(`Invalid acceptance manifest: ${errors.length} error(s)`)
    this.name = 'ManifestError'
    this.errors = errors
  }
}

export function loadManifest(filePath) {
  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new ManifestError([{ path: filePath, message: `cannot read manifest: ${error.message}` }])
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new ManifestError([{ path: filePath, message: `not valid JSON: ${error.message}` }])
  }
}

export function manifestHash(manifest) {
  return sha256Json(manifest)
}

/**
 * Resolves the effective network target for an entry: the executor-declared
 * params key when present, otherwise entry.target. Shared by validation and the
 * runner so both guard the same value.
 */
export function resolveEffectiveTarget(entry, registry) {
  const executor = registry?.get?.(entry?.executor)
  const meta = executor?.target ?? null
  const paramKey = meta?.param ?? null
  const paramTarget = paramKey ? entry?.params?.[paramKey] : undefined
  const entryTarget = entry?.target ?? null
  const hasParamTarget =
    paramTarget !== undefined && paramTarget !== null && String(paramTarget).trim() !== ''
  const hasEntryTarget = entryTarget !== null && String(entryTarget).trim() !== ''
  const effective = hasParamTarget ? paramTarget : hasEntryTarget ? entryTarget : null
  return { meta, paramKey, paramTarget, entryTarget, hasParamTarget, hasEntryTarget, effective }
}

export function sameNetworkTarget(a, b) {
  const left = candidateTokens(a)
  const right = candidateTokens(b)
  for (const token of left) {
    if (right.has(token)) {
      return true
    }
  }
  return false
}

function validateEntryTarget(entry, { guard, registry, push }) {
  const base = `entries[${entry.id}]`
  const { meta, paramKey, paramTarget, entryTarget, hasParamTarget, hasEntryTarget, effective } =
    resolveEffectiveTarget(entry, registry)

  if (hasEntryTarget) {
    const result = guard.checkTarget(entryTarget)
    if (!result.allowed) {
      push(`${base}.target`, result.reason)
    }
  }

  if (meta?.required) {
    if (hasEntryTarget && hasParamTarget && !sameNetworkTarget(entryTarget, paramTarget)) {
      push(
        base,
        `entry.target ${JSON.stringify(entryTarget)} disagrees with params.${paramKey} ${JSON.stringify(paramTarget)}`,
      )
    }
    if (!effective) {
      push(base, `executor ${entry.executor} requires a network target via params.${paramKey}`)
      return
    }
    const result = guard.checkTarget(effective)
    if (!result.allowed) {
      push(base, `${result.reason} (effective target ${JSON.stringify(effective)})`)
    }
  }

  if (entry.evidenceClass === 'external' && (!effective || !guard.isExplicitlyAllowed(effective))) {
    push(
      base,
      `external evidence target ${JSON.stringify(effective)} must be explicitly allow-listed`,
    )
  }
}

export function validateManifest(manifest, { guard, registry } = {}) {
  const errors = []
  const push = (path, message) => errors.push({ path, message })

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: [{ path: '$', message: 'manifest must be a JSON object' }] }
  }
  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    push('manifestVersion', `must equal ${MANIFEST_VERSION}`)
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    push('name', 'must be a non-empty string')
  }
  if (manifest.allow !== undefined && !Array.isArray(manifest.allow)) {
    push('allow', 'must be an array of strings when present')
  }
  if (manifest.allowUnknown !== undefined) {
    push('allowUnknown', 'is not supported; targets must be explicitly allow-listed')
  }

  const entries = manifest.entries
  if (!Array.isArray(entries) || entries.length === 0) {
    push('entries', 'must be a non-empty array')
  } else {
    const byId = new Map()
    entries.forEach((entry, index) => {
      const base = `entries[${index}]`
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        push(base, 'must be an object')
        return
      }
      if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) {
        push(`${base}.id`, 'must be a string matching [a-z0-9][a-z0-9._-]*')
      } else if (byId.has(entry.id)) {
        push(`${base}.id`, `duplicate id ${entry.id}`)
      } else {
        byId.set(entry.id, entry)
      }
      if (typeof entry.name !== 'string' || entry.name.trim() === '') {
        push(`${base}.name`, 'must be a non-empty string')
      }
      try {
        assertEvidenceClass(entry.evidenceClass, `${base}.evidenceClass`)
      } catch (error) {
        push(`${base}.evidenceClass`, error.message)
      }
      if (typeof entry.executor !== 'string' || entry.executor.trim() === '') {
        push(`${base}.executor`, 'must be a non-empty string')
      }
      if (entry.required !== undefined && typeof entry.required !== 'boolean') {
        push(`${base}.required`, 'must be a boolean when present')
      }
      if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
        push(`${base}.enabled`, 'must be a boolean when present')
      }
      if (entry.target !== undefined && entry.target !== null && typeof entry.target !== 'string') {
        push(`${base}.target`, 'must be a string when present')
      }
      if (entry.dependsOn !== undefined && !Array.isArray(entry.dependsOn)) {
        push(`${base}.dependsOn`, 'must be an array of entry ids when present')
      }
    })

    for (const [id, entry] of byId) {
      const deps = Array.isArray(entry.dependsOn) ? entry.dependsOn : []
      for (const dependency of deps) {
        if (dependency === id) {
          push(`entries[${id}].dependsOn`, 'must not depend on itself')
        } else if (!byId.has(dependency)) {
          push(`entries[${id}].dependsOn`, `unknown dependency ${JSON.stringify(dependency)}`)
        }
      }
    }

    if (guard) {
      for (const entry of byId.values()) {
        if (entry.enabled === false) {
          continue
        }
        validateEntryTarget(entry, { guard, registry, push })
      }
    }

    const cycle = findCycle(
      entries.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string'),
    )
    if (cycle) {
      push('entries', `dependency cycle detected: ${cycle.join(' -> ')}`)
    }
  }

  if (guard) {
    const found = guard.scanForDenied(JSON.stringify(manifest))
    if (found.length > 0) {
      push('$', `manifest references denied production endpoint(s): ${found.join(', ')}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

export function assertValidManifest(manifest, options) {
  const result = validateManifest(manifest, options)
  if (!result.valid) {
    throw new ManifestError(result.errors)
  }
  return manifest
}

function findCycle(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const visiting = new Set()
  const visited = new Set()
  const stack = []
  let cycle = null

  function visit(id) {
    if (cycle || visited.has(id)) {
      return
    }
    if (visiting.has(id)) {
      const start = stack.indexOf(id)
      cycle = [...stack.slice(start), id]
      return
    }
    visiting.add(id)
    stack.push(id)
    const entry = byId.get(id)
    for (const dependency of Array.isArray(entry?.dependsOn) ? entry.dependsOn : []) {
      if (byId.has(dependency)) {
        visit(dependency)
      }
    }
    stack.pop()
    visiting.delete(id)
    visited.add(id)
  }

  for (const id of byId.keys()) {
    visit(id)
  }
  return cycle
}

export function orderEntries(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const ordered = []
  const visited = new Set()

  function visit(entry) {
    if (visited.has(entry.id)) {
      return
    }
    visited.add(entry.id)
    for (const dependency of Array.isArray(entry.dependsOn) ? entry.dependsOn : []) {
      const parent = byId.get(dependency)
      if (parent) {
        visit(parent)
      }
    }
    ordered.push(entry)
  }

  for (const entry of entries) {
    visit(entry)
  }
  return ordered
}
