import type { ModuleContext, SurfaceModule } from '../../shell/module-registry'

/**
 * Thin Mail composition boundary. The real Mail workspace is delivered by the
 * mail-ui workstream as its own lazy bundle; this shell module only proves the
 * mount contract and must never contain mail domain logic.
 */
export const surfaceModule: SurfaceModule = {
  id: 'mail',
  mount(target: HTMLElement, context: ModuleContext): void {
    target.dataset.navinSurface = 'mail'
    target.textContent = `Navin Mail surface (${context.channel}); composition boundary only.`
  },
}

export default surfaceModule
