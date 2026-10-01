import { Type, type Static } from '@sinclair/typebox'

export const NavinSurfaceSchema = Type.Union([
  Type.Literal('mail'),
  Type.Literal('control'),
  Type.Literal('cli'),
])
export type NavinSurface = Static<typeof NavinSurfaceSchema>

export const DeliveryChannelSchema = Type.Union([
  Type.Literal('web'),
  Type.Literal('desktop'),
  Type.Literal('terminal'),
])
export type DeliveryChannel = Static<typeof DeliveryChannelSchema>

export const SurfaceContextSchema = Type.Object(
  {
    surface: NavinSurfaceSchema,
    channel: DeliveryChannelSchema,
    instanceId: Type.Optional(Type.String({ minLength: 1 })),
    organizationId: Type.Optional(Type.String({ minLength: 1 })),
    activeSessionId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
)
export type SurfaceContext = Static<typeof SurfaceContextSchema>
