export const EVIDENCE_CLASSES = Object.freeze({
  unit: Object.freeze({ id: 'unit', rank: 1, label: 'Unit and contract tests' }),
  integration: Object.freeze({ id: 'integration', rank: 2, label: 'Local process integration' }),
  protocol: Object.freeze({ id: 'protocol', rank: 3, label: 'Real mail-protocol integration' }),
  browser: Object.freeze({ id: 'browser', rank: 4, label: 'Browser E2E' }),
  desktop: Object.freeze({ id: 'desktop', rank: 5, label: 'Packaged Desktop proof' }),
  vm_operations: Object.freeze({
    id: 'vm_operations',
    rank: 6,
    label: 'Disposable VM/VPS operations',
  }),
  migration: Object.freeze({ id: 'migration', rank: 7, label: 'Migration evidence' }),
  backup_restore: Object.freeze({
    id: 'backup_restore',
    rank: 8,
    label: 'Backup and restore evidence',
  }),
  external: Object.freeze({ id: 'external', rank: 9, label: 'External DNS and network evidence' }),
  manual: Object.freeze({ id: 'manual', rank: 10, label: 'Manual owner acceptance' }),
})

export const EVIDENCE_CLASS_IDS = Object.freeze(Object.keys(EVIDENCE_CLASSES))

export function isEvidenceClass(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EVIDENCE_CLASSES, value)
}

export function assertEvidenceClass(value, context = 'evidenceClass') {
  if (!isEvidenceClass(value)) {
    throw new TypeError(
      `${context} must be one of ${EVIDENCE_CLASS_IDS.join(', ')}, received ${JSON.stringify(value)}`,
    )
  }
  return value
}

export function evidenceRank(value) {
  assertEvidenceClass(value)
  return EVIDENCE_CLASSES[value].rank
}

export function describeClass(value) {
  assertEvidenceClass(value)
  const entry = EVIDENCE_CLASSES[value]
  return `${entry.id} (${entry.label}, strength ${entry.rank})`
}

export function canSatisfy(providedClass, requiredClass) {
  return evidenceRank(providedClass) >= evidenceRank(requiredClass)
}

export function insufficientEvidence(providedClass, requiredClass) {
  return !canSatisfy(providedClass, requiredClass)
}
