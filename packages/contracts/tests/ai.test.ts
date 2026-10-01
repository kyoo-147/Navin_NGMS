import { describe, it, expect } from 'vitest'
import {
  AiProviderTypeSchema,
  AiProviderManifestSchema,
  MailAssistantToolSchema,
  ControlOperatorToolSchema,
  AiSessionCatalogSchema,
  EndpointUriSchema,
  validate,
  isValid,
} from '../src/index.js'

describe('AI Provider Manifest Contracts', () => {
  it('validates supported provider types including no-AI (none)', () => {
    const types = ['navin_managed', 'oauth', 'api_key', 'openai_compatible', 'local_model', 'none']
    for (const t of types) {
      expect(isValid(AiProviderTypeSchema, t)).toBe(true)
    }
    expect(isValid(AiProviderTypeSchema, 'unknown_type')).toBe(false)
  })

  it('validates surface-scoped tool catalogs strictly separating Mail and Control', () => {
    expect(isValid(MailAssistantToolSchema, 'mail.summarize')).toBe(true)
    expect(isValid(MailAssistantToolSchema, 'mail.draft')).toBe(true)
    expect(isValid(MailAssistantToolSchema, 'control.user.create')).toBe(false) // Prohibited in Mail

    expect(isValid(ControlOperatorToolSchema, 'control.discover')).toBe(true)
    expect(isValid(ControlOperatorToolSchema, 'control.plan')).toBe(true)
    expect(isValid(ControlOperatorToolSchema, 'mail.draft')).toBe(false) // Prohibited in Control
  })

  it('validates AiSessionCatalogSchema enforcing surface-isolated tools', () => {
    // Valid Mail session catalog
    expect(
      isValid(AiSessionCatalogSchema, {
        surface: 'mail',
        tools: ['mail.summarize', 'mail.draft'],
      }),
    ).toBe(true)

    // Valid Control session catalog
    expect(
      isValid(AiSessionCatalogSchema, {
        surface: 'control',
        tools: ['control.discover', 'control.plan'],
      }),
    ).toBe(true)

    // Negative: Mail session catalog receiving Control tool
    expect(
      isValid(AiSessionCatalogSchema, {
        surface: 'mail',
        tools: ['control.discover'],
      }),
    ).toBe(false)

    // Negative: Control session catalog receiving Mail tool
    expect(
      isValid(AiSessionCatalogSchema, {
        surface: 'control',
        tools: ['mail.draft'],
      }),
    ).toBe(false)
  })

  it('validates endpoint URI patterns', () => {
    expect(isValid(EndpointUriSchema, 'http://127.0.0.1:11434/v1')).toBe(true)
    expect(isValid(EndpointUriSchema, 'https://api.openai.com/v1')).toBe(true)
    expect(isValid(EndpointUriSchema, 'ftp://invalid-scheme.com')).toBe(false)
    expect(isValid(EndpointUriSchema, 'javascript:alert(1)')).toBe(false)
  })

  it('validates an AI provider manifest and rejects cross-surface tool pollution', () => {
    const validManifest = {
      id: 'prv_ollama_local',
      name: 'Local Ollama Llama 3',
      type: 'local_model',
      endpoint: 'http://127.0.0.1:11434/v1',
      supportedSurfaces: ['mail', 'control'],
      models: [
        {
          id: 'llama3.2:latest',
          displayName: 'Llama 3.2 3B',
          contextWindow: 128000,
          supportsTools: true,
          supportsStructuredOutput: true,
        },
      ],
      toolCatalogs: {
        mailAssistantTools: ['mail.summarize', 'mail.draft'],
        controlOperatorTools: ['control.discover', 'control.plan'],
      },
      dataPolicy: {
        storeData: false,
        trainOnData: false,
        sendContentOutsideHost: false,
      },
    }

    expect(isValid(AiProviderManifestSchema, validManifest)).toBe(true)
    const res = validate(AiProviderManifestSchema, validManifest)
    expect(res.success).toBe(true)

    // Negative: manifest with Control tool in mailAssistantTools
    const invalidMailToolsManifest = {
      ...validManifest,
      toolCatalogs: {
        ...validManifest.toolCatalogs,
        mailAssistantTools: ['control.discover'],
      },
    }
    expect(isValid(AiProviderManifestSchema, invalidMailToolsManifest)).toBe(false)

    // Negative: manifest with Mail tool in controlOperatorTools
    const invalidControlToolsManifest = {
      ...validManifest,
      toolCatalogs: {
        ...validManifest.toolCatalogs,
        controlOperatorTools: ['mail.draft'],
      },
    }
    expect(isValid(AiProviderManifestSchema, invalidControlToolsManifest)).toBe(false)
  })
})
