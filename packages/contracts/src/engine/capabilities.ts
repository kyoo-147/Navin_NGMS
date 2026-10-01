import { Type, type Static } from '@sinclair/typebox'

export const EngineProtocolSupportSchema = Type.Object(
  {
    jmap: Type.Boolean(),
    imap: Type.Boolean(),
    pop3: Type.Boolean(),
    smtpSubmission: Type.Boolean(),
    lmtp: Type.Boolean(),
    manageSieve: Type.Boolean(),
    caldav: Type.Boolean(),
    carddav: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type EngineProtocolSupport = Static<typeof EngineProtocolSupportSchema>

export const EngineFeatureSupportSchema = Type.Object(
  {
    pushNotifications: Type.Boolean(),
    serverSideSearch: Type.Boolean(),
    fullTextIndexing: Type.Boolean(),
    storageQuota: Type.Boolean(),
    aliases: Type.Boolean(),
    distributionGroups: Type.Boolean(),
    dkimSigning: Type.Boolean(),
    tlsEnforcement: Type.Boolean(),
    adminApi: Type.Boolean(),
  },
  { additionalProperties: false },
)
export type EngineFeatureSupport = Static<typeof EngineFeatureSupportSchema>

export const EngineLimitsSchema = Type.Object(
  {
    maxMessageSizeBytes: Type.Optional(Type.Number({ minimum: 0 })),
    maxRecipientsPerMessage: Type.Optional(Type.Number({ minimum: 1 })),
    maxAttachmentSizeBytes: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
)
export type EngineLimits = Static<typeof EngineLimitsSchema>

export const EngineConnectionSchema = Type.Object(
  {
    endpoint: Type.String({
      minLength: 1,
      pattern: '^https?://[a-zA-Z0-9.-]+(:[0-9]+)?(/.*)?$',
      description: 'Strict HTTP or HTTPS URI endpoint',
    }),
    secure: Type.Boolean(),
    authMethods: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
)
export type EngineConnection = Static<typeof EngineConnectionSchema>

export const EngineAdapterDescriptorSchema = Type.Object(
  {
    engineId: Type.String({ minLength: 1, pattern: '^[a-z0-9_-]+$' }),
    displayName: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
    protocols: EngineProtocolSupportSchema,
    features: EngineFeatureSupportSchema,
    limits: Type.Optional(EngineLimitsSchema),
    connection: Type.Optional(EngineConnectionSchema),
  },
  { additionalProperties: false },
)
export type EngineAdapterDescriptor = Static<typeof EngineAdapterDescriptorSchema>
