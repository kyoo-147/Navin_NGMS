import { Type, type Static } from '@sinclair/typebox'

export const ExtensionCapabilitySchema = Type.Union([
  Type.Literal('dns.read'),
  Type.Literal('dns.plan'),
  Type.Literal('dns.apply'),
  Type.Literal('mail.engine'),
  Type.Literal('deploy.adapter'),
  Type.Literal('proxy.manage'),
  Type.Literal('tls.acme'),
  Type.Literal('backup.target'),
  Type.Literal('migration.connector'),
  Type.Literal('relay.provider'),
  Type.Literal('ai.provider'),
  Type.Literal('identity.provider'),
  Type.Literal('notify.provider'),
  Type.Literal('ui.page'),
  Type.Literal('ui.slot'),
  Type.Literal('schedule.manage'),
  Type.Literal('policy.enforce'),
])
export type ExtensionCapability = Static<typeof ExtensionCapabilitySchema>

export const ExtensionTrustTierSchema = Type.Union([
  Type.Literal('operator-installed'),
  Type.Literal('built_in'),
  Type.Literal('development'),
])
export type ExtensionTrustTier = Static<typeof ExtensionTrustTierSchema>

export const ExtensionEntryPointsSchema = Type.Object(
  {
    backend: Type.Optional(Type.String({ minLength: 1 })),
    ui: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
)
export type ExtensionEntryPoints = Static<typeof ExtensionEntryPointsSchema>

export const ExtensionSurfaceRegistrationsSchema = Type.Object(
  {
    surfaces: Type.Array(Type.Union([Type.Literal('mail'), Type.Literal('control')]), {
      minItems: 1,
    }),
    uiSlots: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    uiPages: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
)
export type ExtensionSurfaceRegistrations = Static<typeof ExtensionSurfaceRegistrationsSchema>

export const NavinExtensionMetadataSchema = Type.Object(
  {
    apiVersion: Type.Literal('1'),
    trust: ExtensionTrustTierSchema,
    capabilities: Type.Array(ExtensionCapabilitySchema),
    entryPoints: Type.Optional(ExtensionEntryPointsSchema),
    surfaceRegistrations: Type.Optional(ExtensionSurfaceRegistrationsSchema),
    settingsSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    secretKeys: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
)
export type NavinExtensionMetadata = Static<typeof NavinExtensionMetadataSchema>

export const ExtensionManifestSchema = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      pattern: '^(@[a-z0-9_.-]+/)?[a-z0-9_.-]+$',
      description: 'Standard package name format (e.g. @navin/ext-dns)',
    }),
    version: Type.String({
      pattern:
        '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$',
      description: 'Official SemVer 2.0 specification string',
    }),
    description: Type.Optional(Type.String()),
    author: Type.Optional(Type.String()),
    license: Type.Optional(Type.String()),
    navin: NavinExtensionMetadataSchema,
  },
  { additionalProperties: false },
)
export type ExtensionManifest = Static<typeof ExtensionManifestSchema>
