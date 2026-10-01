import { getCorrelationId } from '../correlation/context.js'
import { redactValue } from '../logging/redact.js'
import type { Clock } from '../ports/clock.js'
import type { LogFields, LogLevel, Logger, LoggerSink } from '../ports/logger.js'

const LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

export interface JsonLoggerOptions {
  level: LogLevel
  clock: Clock
  /** Fields merged into every record (for example `service`, `version`, `env`). */
  base?: LogFields
  /** Fixed sink. When omitted, records route to stdout/stderr by level. */
  sink?: LoggerSink
  /** Mask sensitive field names. Defaults to `true`. */
  redact?: boolean
  /**
   * Exact secret values scrubbed from any logged string, message or stack.
   * The container registers configuration secrets here at startup.
   */
  redactLiterals?: readonly string[]
}

export class JsonLogger implements Logger {
  readonly level: LogLevel

  private readonly threshold: number
  private readonly base: LogFields
  private readonly clock: Clock
  private readonly sink: LoggerSink | undefined
  private readonly redact: boolean
  private readonly redactLiterals: readonly string[]

  constructor(options: JsonLoggerOptions) {
    this.level = options.level
    this.threshold = LEVEL_VALUES[options.level]
    this.base = options.base ?? {}
    this.clock = options.clock
    this.sink = options.sink
    this.redact = options.redact ?? true
    this.redactLiterals = options.redactLiterals ?? []
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LEVEL_VALUES[level] >= this.threshold
  }

  child(fields: LogFields): Logger {
    return new JsonLogger({
      level: this.level,
      clock: this.clock,
      base: { ...this.base, ...fields },
      sink: this.sink,
      redact: this.redact,
      redactLiterals: this.redactLiterals,
    })
  }

  log(level: LogLevel, message: string, fields?: LogFields): void {
    if (!this.isLevelEnabled(level)) {
      return
    }

    const record: LogFields = {
      level,
      time: this.clock.nowIso(),
      msg: message,
      ...this.base,
      ...fields,
    }

    if (record.correlationId === undefined) {
      const correlationId = getCorrelationId()
      if (correlationId !== undefined) {
        record.correlationId = correlationId
      }
    }

    const line = `${JSON.stringify(
      redactValue(record, { redact: this.redact, literals: this.redactLiterals }),
    )}\n`
    this.resolveSink(level).write(line)
  }

  trace(message: string, fields?: LogFields): void {
    this.log('trace', message, fields)
  }

  debug(message: string, fields?: LogFields): void {
    this.log('debug', message, fields)
  }

  info(message: string, fields?: LogFields): void {
    this.log('info', message, fields)
  }

  warn(message: string, fields?: LogFields): void {
    this.log('warn', message, fields)
  }

  error(message: string, fields?: LogFields): void {
    this.log('error', message, fields)
  }

  fatal(message: string, fields?: LogFields): void {
    this.log('fatal', message, fields)
  }

  private resolveSink(level: LogLevel): LoggerSink {
    if (this.sink) {
      return this.sink
    }
    return level === 'error' || level === 'fatal' ? process.stderr : process.stdout
  }
}
