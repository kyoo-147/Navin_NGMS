import { ProtocolError } from './errors.js'
import { assertNoWireControlBytes } from './wire.js'

/** Rejects CR/LF/NUL bytes to prevent command and header injection. */
export function assertNoControlBytes(value: string, field: string): string {
  try {
    return assertNoWireControlBytes(value, field, 'smtp')
  } catch (error) {
    if (error instanceof ProtocolError) {
      throw new ProtocolError('MESSAGE_REJECTED', error.message, {
        protocol: 'smtp',
        details: { field },
        cause: error,
      })
    }
    throw error
  }
}

/** Wraps an address in angle brackets after validating it is injection-safe. */
export function formatMailbox(address: string): string {
  assertNoControlBytes(address, 'address')
  const trimmed = address.trim()
  if (trimmed.length === 0) {
    throw new ProtocolError('MESSAGE_REJECTED', 'Empty mailbox address', { protocol: 'smtp' })
  }
  if (trimmed.includes('<') || trimmed.includes('>')) {
    throw new ProtocolError('MESSAGE_REJECTED', 'Malformed mailbox address', {
      protocol: 'smtp',
      details: { address: trimmed },
    })
  }
  return `<${trimmed}>`
}
