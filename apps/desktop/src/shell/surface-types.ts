/**
 * Local mirror of the frozen `NavinSurface` union from @navin/contracts. The
 * desktop shell deliberately does not depend on the contracts build at runtime
 * (it must boot even if a surface bundle fails); this type only needs to stay
 * structurally compatible with `NavinSurface`.
 */
export type NavinSurface = 'mail' | 'control'

export type DeliveryChannel = 'desktop' | 'web'
