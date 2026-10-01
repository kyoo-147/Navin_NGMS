import { ActionCoreError } from '../errors.js'
import type { ActionExecutorPort, JobHandlerPort } from './ports.js'

function namespaceOf(name: string): string {
  const separator = name.indexOf('.')
  return separator === -1 ? name : name.slice(0, separator)
}

/**
 * Resolves executor and job-handler ports by name.
 *
 * Action names are namespaced (`dns.update_dkim_selector`). Resolution prefers an
 * exact match, then falls back to a port registered for the leading namespace
 * (`dns`) so one adapter can serve a family of actions.
 */
export class ExecutorRegistry {
  private readonly executors = new Map<string, ActionExecutorPort>()
  private readonly handlers = new Map<string, JobHandlerPort>()

  registerExecutor(port: ActionExecutorPort): void {
    this.assertName(port.name, 'executor')
    this.executors.set(port.name, port)
  }

  registerJobHandler(port: JobHandlerPort): void {
    this.assertName(port.name, 'job handler')
    this.handlers.set(port.name, port)
  }

  findExecutor(actionName: string): ActionExecutorPort | undefined {
    return this.executors.get(actionName) ?? this.executors.get(namespaceOf(actionName))
  }

  requireExecutor(actionName: string): ActionExecutorPort {
    const executor = this.findExecutor(actionName)
    if (executor === undefined) {
      throw new ActionCoreError(
        'NOT_FOUND',
        `No executor port registered for action ${actionName}`,
        {
          details: { actionName, registered: [...this.executors.keys()] },
        },
      )
    }
    return executor
  }

  findJobHandler(name: string): JobHandlerPort | undefined {
    return this.handlers.get(name) ?? this.handlers.get(namespaceOf(name))
  }

  requireJobHandler(name: string): JobHandlerPort {
    const handler = this.findJobHandler(name)
    if (handler === undefined) {
      throw new ActionCoreError('NOT_FOUND', `No job handler registered for ${name}`, {
        details: { name, registered: [...this.handlers.keys()] },
      })
    }
    return handler
  }

  executorNames(): string[] {
    return [...this.executors.keys()].sort()
  }

  jobHandlerNames(): string[] {
    return [...this.handlers.keys()].sort()
  }

  private assertName(name: string, kind: string): void {
    if (name.length === 0) {
      throw new ActionCoreError('VALIDATION_FAILED', `${kind} name must not be empty`)
    }
  }
}
