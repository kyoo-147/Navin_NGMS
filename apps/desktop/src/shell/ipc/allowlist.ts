import rawAllowlist from '../../../ipc/allowlist.json'
import { IpcNotAllowedError } from '../errors'

export interface IpcAllowlist {
  readonly version: number
  readonly commands: readonly string[]
}

interface RawAllowlist {
  readonly version?: unknown
  readonly commands?: unknown
}

function normalize(raw: RawAllowlist): IpcAllowlist {
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    throw new Error('desktop ipc allowlist: "version" must be a positive integer')
  }
  if (!Array.isArray(raw.commands) || raw.commands.length === 0) {
    throw new Error('desktop ipc allowlist: "commands" must be a non-empty array')
  }
  const commands: string[] = []
  for (const entry of raw.commands) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error('desktop ipc allowlist: every command must be a non-empty string')
    }
    commands.push(entry)
  }
  return Object.freeze({ version: raw.version, commands: Object.freeze(commands) })
}

/** Parsed once at module load; a malformed allowlist aborts the shell (fail closed). */
export const ipcAllowlist: IpcAllowlist = normalize(rawAllowlist as RawAllowlist)

const allowedCommands: ReadonlySet<string> = new Set(ipcAllowlist.commands)

export function isAllowedCommand(command: string): boolean {
  return allowedCommands.has(command)
}

export function assertAllowedCommand(command: string): void {
  if (!isAllowedCommand(command)) {
    throw new IpcNotAllowedError(command)
  }
}
