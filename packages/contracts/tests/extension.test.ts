import { describe, it, expect } from 'vitest'
import {
  ExtensionTrustTierSchema,
  ExtensionCapabilitySchema,
  ExtensionManifestSchema,
  validate,
  isValid,
} from '../src/index.js'

describe('Extension Manifest Contracts', () => {
  it('validates trust tiers (trusted operator-installed in Phase 1)', () => {
    expect(isValid(ExtensionTrustTierSchema, 'operator-installed')).toBe(true)
    expect(isValid(ExtensionTrustTierSchema, 'built_in')).toBe(true)
    expect(isValid(ExtensionTrustTierSchema, 'development')).toBe(true)
    expect(isValid(ExtensionTrustTierSchema, 'untrusted_marketplace')).toBe(false)
  })

  it('validates typed ExtensionCapabilitySchema enums and rejects untyped capabilities', () => {
    const validCapabilities = [
      'dns.read',
      'dns.plan',
      'dns.apply',
      'mail.engine',
      'deploy.adapter',
      'proxy.manage',
      'tls.acme',
      'backup.target',
      'migration.connector',
      'relay.provider',
      'ai.provider',
      'identity.provider',
      'notify.provider',
      'ui.page',
      'ui.slot',
      'schedule.manage',
      'policy.enforce',
    ]

    for (const cap of validCapabilities) {
      expect(isValid(ExtensionCapabilitySchema, cap)).toBe(true)
    }

    expect(isValid(ExtensionCapabilitySchema, 'untyped.arbitrary.capability')).toBe(false)
    expect(isValid(ExtensionCapabilitySchema, 'root.access')).toBe(false)
  })

  it('validates a complete operator-installed extension manifest', () => {
    const manifest = {
      name: '@navin/ext-dns-cloudflare',
      version: '0.1.0',
      description: 'Cloudflare DNS provider for automated MX, SPF, DKIM, and DMARC sync',
      author: 'Navin Core Team',
      license: 'MIT',
      navin: {
        apiVersion: '1',
        trust: 'operator-installed',
        capabilities: ['dns.read', 'dns.plan', 'dns.apply'],
        entryPoints: {
          backend: './src/index.ts',
          ui: './ui/index.ts',
        },
        surfaceRegistrations: {
          surfaces: ['control'],
          uiPages: ['control.dns.cloudflare'],
          uiSlots: ['control.dns.provider_config'],
        },
        secretKeys: ['CLOUDFLARE_API_TOKEN'],
      },
    }

    expect(isValid(ExtensionManifestSchema, manifest)).toBe(true)
    const res = validate(ExtensionManifestSchema, manifest)
    expect(res.success).toBe(true)

    // Negative: manifest with invalid capability
    const invalidCapManifest = {
      ...manifest,
      navin: {
        ...manifest.navin,
        capabilities: ['untyped.capability'],
      },
    }
    expect(isValid(ExtensionManifestSchema, invalidCapManifest)).toBe(false)
  })

  it('enforces SemVer 2.0 version formatting and package naming', () => {
    const baseManifest = {
      name: '@navin/ext-dns-cloudflare',
      version: '1.0.0-beta.1+build.123',
      navin: {
        apiVersion: '1',
        trust: 'built_in',
        capabilities: ['dns.read'],
      },
    }
    expect(isValid(ExtensionManifestSchema, baseManifest)).toBe(true)

    // Invalid SemVer (leading zero in major version)
    expect(
      isValid(ExtensionManifestSchema, {
        ...baseManifest,
        version: '01.0.0',
      }),
    ).toBe(false)

    // Invalid SemVer (missing patch)
    expect(
      isValid(ExtensionManifestSchema, {
        ...baseManifest,
        version: '1.0',
      }),
    ).toBe(false)

    // Invalid SemVer (with v prefix)
    expect(
      isValid(ExtensionManifestSchema, {
        ...baseManifest,
        version: 'v1.0.0',
      }),
    ).toBe(false)

    // Invalid name with spaces
    expect(
      isValid(ExtensionManifestSchema, {
        ...baseManifest,
        name: 'INVALID NAME WITH SPACES',
      }),
    ).toBe(false)
  })
})
