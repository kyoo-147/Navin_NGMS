import { Type, type Static } from '@sinclair/typebox'
import { ProviderIdSchema } from '../common/id.js'

export const EndpointUriSchema = Type.String({
  pattern: '^https?://[a-zA-Z0-9.-]+(:[0-9]+)?(/.*)?$',
  description: 'Strict HTTP or HTTPS URI endpoint',
})
export type EndpointUri = Static<typeof EndpointUriSchema>

export const AiProviderTypeSchema = Type.Union([
  Type.Literal('navin_managed'),
  Type.Literal('oauth'),
  Type.Literal('api_key'),
  Type.Literal('openai_compatible'),
  Type.Literal('local_model'),
  Type.Literal('none'),
])
export type AiProviderType = Static<typeof AiProviderTypeSchema>

export const MailAssistantToolSchema = Type.Union([
  Type.Literal('mail.summarize'),
  Type.Literal('mail.extract_actions'),
  Type.Literal('mail.draft'),
  Type.Literal('mail.rewrite'),
  Type.Literal('mail.translate'),
  Type.Literal('mail.follow_up'),
  Type.Literal('mail.find_related'),
  Type.Literal('mail.propose_event'),
  Type.Literal('mail.search'),
  Type.Literal('mail.read'),
])
export type MailAssistantTool = Static<typeof MailAssistantToolSchema>

export const ControlOperatorToolSchema = Type.Union([
  Type.Literal('control.discover'),
  Type.Literal('control.diagnose'),
  Type.Literal('control.propose_architecture'),
  Type.Literal('control.plan'),
  Type.Literal('control.diff'),
  Type.Literal('control.explain_failure'),
  Type.Literal('control.user.create'),
  Type.Literal('control.domain.add'),
  Type.Literal('control.dns.check'),
  Type.Literal('control.backup.run'),
  Type.Literal('control.restore.plan'),
  Type.Literal('control.update.apply'),
])
export type ControlOperatorTool = Static<typeof ControlOperatorToolSchema>

export const MailAssistantToolCatalogSchema = Type.Object(
  {
    surface: Type.Literal('mail'),
    tools: Type.Array(MailAssistantToolSchema),
  },
  { additionalProperties: false },
)
export type MailAssistantToolCatalog = Static<typeof MailAssistantToolCatalogSchema>

export const ControlOperatorToolCatalogSchema = Type.Object(
  {
    surface: Type.Literal('control'),
    tools: Type.Array(ControlOperatorToolSchema),
  },
  { additionalProperties: false },
)
export type ControlOperatorToolCatalog = Static<typeof ControlOperatorToolCatalogSchema>

export const AiSessionCatalogSchema = Type.Union([
  MailAssistantToolCatalogSchema,
  ControlOperatorToolCatalogSchema,
])
export type AiSessionCatalog = Static<typeof AiSessionCatalogSchema>

export const AiModelDescriptorSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    displayName: Type.String({ minLength: 1 }),
    contextWindow: Type.Number({ minimum: 1 }),
    supportsTools: Type.Boolean(),
    supportsStructuredOutput: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type AiModelDescriptor = Static<typeof AiModelDescriptorSchema>

export const AiDataPolicySchema = Type.Object(
  {
    storeData: Type.Boolean(),
    trainOnData: Type.Boolean(),
    sendContentOutsideHost: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type AiDataPolicy = Static<typeof AiDataPolicySchema>

export const AiToolCatalogsSchema = Type.Object(
  {
    mailAssistantTools: Type.Array(MailAssistantToolSchema),
    controlOperatorTools: Type.Array(ControlOperatorToolSchema),
  },
  { additionalProperties: false },
)
export type AiToolCatalogs = Static<typeof AiToolCatalogsSchema>

export const AiRateLimitsSchema = Type.Object(
  {
    requestsPerMinute: Type.Optional(Type.Number({ minimum: 1 })),
    tokensPerMinute: Type.Optional(Type.Number({ minimum: 1 })),
  },
  { additionalProperties: false },
)
export type AiRateLimits = Static<typeof AiRateLimitsSchema>

export const AiProviderManifestSchema = Type.Object(
  {
    id: ProviderIdSchema,
    name: Type.String({ minLength: 1 }),
    type: AiProviderTypeSchema,
    endpoint: Type.Optional(EndpointUriSchema),
    supportedSurfaces: Type.Array(Type.Union([Type.Literal('mail'), Type.Literal('control')]), {
      minItems: 1,
    }),
    models: Type.Array(AiModelDescriptorSchema),
    toolCatalogs: AiToolCatalogsSchema,
    dataPolicy: AiDataPolicySchema,
    rateLimits: Type.Optional(AiRateLimitsSchema),
  },
  { additionalProperties: false },
)
export type AiProviderManifest = Static<typeof AiProviderManifestSchema>
