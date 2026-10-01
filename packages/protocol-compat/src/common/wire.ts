import { ProtocolError, type ProtocolName } from './errors.js'

/** Rejects controls that can terminate or alter a textual protocol frame. */
export function assertNoWireControlBytes(
  value: string,
  field: string,
  protocol: ProtocolName = 'transport',
): string {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0 || code === 0x0a || code === 0x0d) {
      throw new ProtocolError('PROTOCOL_ERROR', `Illegal control character in ${field}`, {
        protocol,
        details: { field },
      })
    }
  }
  return value
}

export function assertHeaderName(value: string): string {
  assertNoWireControlBytes(value, 'header name', 'smtp')
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) {
    throw new ProtocolError('MESSAGE_REJECTED', 'Invalid MIME header name', {
      protocol: 'smtp',
      details: { field: 'header name' },
    })
  }
  return value
}

export function assertMimeBoundary(value: string): string {
  assertNoWireControlBytes(value, 'MIME boundary', 'smtp')
  if (value.length === 0 || value.length > 70 || /["\\]/.test(value)) {
    throw new ProtocolError('MESSAGE_REJECTED', 'Invalid MIME boundary', {
      protocol: 'smtp',
      details: { field: 'MIME boundary' },
    })
  }
  return value
}
