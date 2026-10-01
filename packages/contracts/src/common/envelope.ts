import { Type, type TSchema, type Static } from '@sinclair/typebox'
import { IdSchema } from './id.js'

export const ApiVersionSchema = Type.Literal('1', {
  description: 'Navin Phase 1 API literal version',
})
export type ApiVersion = Static<typeof ApiVersionSchema>

export const IsoTimestampSchema = Type.String({
  pattern:
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})$',
  description: 'ISO 8601 UTC or offset timestamp',
})
export type IsoTimestamp = Static<typeof IsoTimestampSchema>

export function VersionEnvelopeSchema<T extends TSchema>(payloadSchema: T) {
  return Type.Object(
    {
      apiVersion: ApiVersionSchema,
      kind: Type.String({ minLength: 1, description: 'Envelope discriminator/kind' }),
      id: IdSchema,
      timestamp: IsoTimestampSchema,
      payload: payloadSchema,
      metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    },
    { additionalProperties: false },
  )
}

export type VersionEnvelope<T> = {
  apiVersion: ApiVersion
  kind: string
  id: string
  timestamp: IsoTimestamp
  payload: T
  metadata?: Record<string, unknown>
}
