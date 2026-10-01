import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface FixtureCertificate {
  key: Buffer
  cert: Buffer
}

let cached: FixtureCertificate | null | undefined

/**
 * Generates a throwaway self-signed certificate for STARTTLS fixtures. The key
 * is created at test time under the OS temp directory and never committed.
 * Returns `null` when OpenSSL is unavailable so TLS tests can skip cleanly.
 */
export function loadFixtureCertificate(): FixtureCertificate | null {
  if (cached !== undefined) return cached
  try {
    const directory = mkdtempSync(join(tmpdir(), 'navin-protocol-compat-tls-'))
    const keyPath = join(directory, 'key.pem')
    const certPath = join(directory, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '2',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    )
    cached = { key: readFileSync(keyPath), cert: readFileSync(certPath) }
  } catch {
    cached = null
  }
  return cached
}
