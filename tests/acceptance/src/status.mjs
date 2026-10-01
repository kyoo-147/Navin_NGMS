export const STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  NOT_RUN: 'NOT_RUN',
})

export const ALL_STATUSES = Object.freeze(Object.values(STATUS))

const EXIT_CODES = Object.freeze({
  [STATUS.PASS]: 0,
  [STATUS.FAIL]: 1,
  [STATUS.BLOCKED]: 2,
  [STATUS.NOT_RUN]: 3,
})

const PRECEDENCE = [STATUS.FAIL, STATUS.BLOCKED, STATUS.NOT_RUN, STATUS.PASS]

export function isStatus(value) {
  return typeof value === 'string' && ALL_STATUSES.includes(value)
}

export function assertStatus(value, context = 'status') {
  if (!isStatus(value)) {
    throw new TypeError(
      `${context} must be one of ${ALL_STATUSES.join(', ')}, received ${JSON.stringify(value)}`,
    )
  }
  return value
}

export function exitCodeFor(status) {
  if (!isStatus(status)) {
    return 4
  }
  return EXIT_CODES[status]
}

export function aggregateStatus(statuses) {
  const list = Array.from(statuses ?? [])
  if (list.length === 0) {
    return STATUS.NOT_RUN
  }
  for (const status of PRECEDENCE) {
    if (list.includes(status)) {
      return status
    }
  }
  return STATUS.NOT_RUN
}

export function isEmptyForAggregate(status) {
  return status === STATUS.NOT_RUN
}
