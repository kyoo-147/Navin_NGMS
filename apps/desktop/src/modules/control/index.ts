import type { ModuleContext, SurfaceModule } from '../../shell/module-registry'

/**
 * Thin Control composition boundary. Control is permission-gated by the shell
 * before this module is ever imported; the real Control renderer arrives with
 * the control-ui workstream. No setup, action or engine logic lives here.
 */
export const surfaceModule: SurfaceModule = {
  id: 'control',
  mount(target: HTMLElement, context: ModuleContext): void {
    target.dataset.navinSurface = 'control'
    target.textContent = `Navin Control surface (${context.channel}); composition boundary only.`
  },
}

export default surfaceModule
