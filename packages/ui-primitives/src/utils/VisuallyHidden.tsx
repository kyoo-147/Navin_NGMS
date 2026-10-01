import type { ReactNode } from 'react'

export interface VisuallyHiddenProps {
  children: ReactNode
}

export function VisuallyHidden({ children }: VisuallyHiddenProps) {
  return <span className="navin-visually-hidden">{children}</span>
}
