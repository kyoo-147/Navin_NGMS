export class PreconditionError extends Error {
  constructor(message, { code = 'PRECONDITION_UNMET', detail = null } = {}) {
    super(message)
    this.name = 'PreconditionError'
    this.code = code
    this.detail = detail
  }
}

export class ExecutorTimeoutError extends Error {
  constructor(message, { code = 'EXECUTOR_TIMEOUT' } = {}) {
    super(message)
    this.name = 'ExecutorTimeoutError'
    this.code = code
  }
}
