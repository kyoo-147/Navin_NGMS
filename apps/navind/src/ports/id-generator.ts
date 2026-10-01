/**
 * Identifier port.
 *
 * Identifiers that cross a process or persistence boundary are generated
 * through this port so the production adapter can use a cryptographically
 * strong source while tests can inject a deterministic sequence.
 */
export interface IdGenerator {
  /**
   * Generate a new identifier.
   *
   * @param prefix Short, stable namespace prefix (for example `req` or `evt`).
   */
  next(prefix?: string): string
}
