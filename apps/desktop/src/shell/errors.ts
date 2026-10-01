export type ShellErrorCode =
  | 'ipc_not_allowed'
  | 'native_bridge_unavailable'
  | 'secret_storage_unavailable'
  | 'endpoint_rejected'
  | 'deep_link_rejected'
  | 'update_rejected'
  | 'module_not_entitled'

export class ShellError extends Error {
  readonly code: ShellErrorCode

  constructor(code: ShellErrorCode, message: string) {
    super(message)
    this.name = 'ShellError'
    this.code = code
  }
}

export class IpcNotAllowedError extends ShellError {
  readonly command: string

  constructor(command: string) {
    super('ipc_not_allowed', `IPC command "${command}" is not in the desktop allowlist`)
    this.name = 'IpcNotAllowedError'
    this.command = command
  }
}

export class NativeBridgeUnavailableError extends ShellError {
  constructor(command: string) {
    super(
      'native_bridge_unavailable',
      `No native transport is installed; refusing to run "${command}" without failing closed`,
    )
    this.name = 'NativeBridgeUnavailableError'
  }
}

export class ModuleNotEntitledError extends ShellError {
  constructor(moduleId: string) {
    super('module_not_entitled', `Surface module "${moduleId}" is not entitled for this session`)
    this.name = 'ModuleNotEntitledError'
  }
}

export class EndpointPolicyError extends ShellError {
  readonly reason: string

  constructor(reason: string, message: string) {
    super('endpoint_rejected', message)
    this.name = 'EndpointPolicyError'
    this.reason = reason
  }
}

export class DeepLinkRejectedError extends ShellError {
  readonly reason: string

  constructor(reason: string, message: string) {
    super('deep_link_rejected', message)
    this.name = 'DeepLinkRejectedError'
    this.reason = reason
  }
}

export class SecretStorageUnavailableError extends ShellError {
  constructor(operation: string) {
    super(
      'secret_storage_unavailable',
      `No OS keychain is available; refusing to ${operation} secrets (no plaintext fallback)`,
    )
    this.name = 'SecretStorageUnavailableError'
  }
}

export class UpdatePolicyError extends ShellError {
  readonly reason: string

  constructor(reason: string, message: string) {
    super('update_rejected', message)
    this.name = 'UpdatePolicyError'
    this.reason = reason
  }
}
