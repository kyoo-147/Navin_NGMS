export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

export type LogFields = Record<string, unknown>

export interface LoggerSink {
  write(chunk: string): void
}

/**
 * Structured logging port.
 *
 * The kernel never logs through `console`. Every log call flows through this
 * port so the transport, redaction and correlation behaviour can be replaced
 * without touching call sites.
 */
export interface Logger {
  readonly level: LogLevel
  isLevelEnabled(level: LogLevel): boolean
  child(fields: LogFields): Logger
  log(level: LogLevel, message: string, fields?: LogFields): void
  trace(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  fatal(message: string, fields?: LogFields): void
}
