import { describe, it, expect } from 'vitest'
import {
  EngineAdapterDescriptorSchema,
  EngineProtocolSupportSchema,
  EngineFeatureSupportSchema,
  validate,
  isValid,
} from '../src/index.js'

describe('Engine Adapter Capability Contracts', () => {
  it('validates protocol support schema', () => {
    const protocols = {
      jmap: true,
      imap: true,
      pop3: false,
      smtpSubmission: true,
      lmtp: false,
      manageSieve: true,
      caldav: true,
      carddav: true,
    }

    expect(isValid(EngineProtocolSupportSchema, protocols)).toBe(true)
  })

  it('validates feature support schema', () => {
    const features = {
      pushNotifications: true,
      serverSideSearch: true,
      fullTextIndexing: true,
      storageQuota: true,
      aliases: true,
      distributionGroups: true,
      dkimSigning: true,
      tlsEnforcement: true,
      adminApi: true,
    }

    expect(isValid(EngineFeatureSupportSchema, features)).toBe(true)
  })

  it('validates a complete Stalwart EngineAdapterDescriptor', () => {
    const descriptor = {
      engineId: 'stalwart',
      displayName: 'Stalwart Mail Server Adapter',
      version: '0.11.0',
      protocols: {
        jmap: true,
        imap: true,
        pop3: false,
        smtpSubmission: true,
        lmtp: false,
        manageSieve: true,
        caldav: true,
        carddav: true,
      },
      features: {
        pushNotifications: true,
        serverSideSearch: true,
        fullTextIndexing: true,
        storageQuota: true,
        aliases: true,
        distributionGroups: true,
        dkimSigning: true,
        tlsEnforcement: true,
        adminApi: true,
      },
      limits: {
        maxMessageSizeBytes: 52428800, // 50MB
        maxRecipientsPerMessage: 100,
        maxAttachmentSizeBytes: 36700160, // 35MB
      },
      connection: {
        endpoint: 'http://127.0.0.1:8080',
        secure: false,
        authMethods: ['password', 'token'],
      },
    }

    expect(isValid(EngineAdapterDescriptorSchema, descriptor)).toBe(true)
    const res = validate(EngineAdapterDescriptorSchema, descriptor)
    expect(res.success).toBe(true)
  })

  it('rejects invalid or incomplete engine descriptors', () => {
    const incomplete = {
      engineId: '',
      displayName: 'Missing protocols',
      version: '1.0.0',
    }

    expect(isValid(EngineAdapterDescriptorSchema, incomplete)).toBe(false)
  })
})
