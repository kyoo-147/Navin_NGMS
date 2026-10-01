export interface SecretRef {
  readonly namespace: string
  readonly name: string
}

export interface SecretStoreAdapter {
  readonly kind: 'os-keychain' | 'memory' | 'unavailable'
  /** Only a persistent OS-backed store may hold refresh material across launches. */
  readonly persistent: boolean
  store(ref: SecretRef, value: string): Promise<void>
  retrieve(ref: SecretRef): Promise<string | null>
  remove(ref: SecretRef): Promise<void>
}

export interface DeepLinkAdapter {
  subscribe(handler: (url: string) => void): Promise<() => void>
  initialUrls(): Promise<readonly string[]>
}

export interface FileDialogFilter {
  readonly name: string
  readonly extensions: readonly string[]
}

export interface FileDialogOptions {
  readonly title?: string
  readonly filters?: readonly FileDialogFilter[]
}

export interface FileDialogAdapter {
  readonly supported: boolean
  open(options?: FileDialogOptions): Promise<string | null>
  save(options?: FileDialogOptions): Promise<string | null>
}

export interface NotificationInput {
  readonly title: string
  readonly body?: string
}

export interface NotificationAdapter {
  isGranted(): Promise<boolean>
  requestPermission(): Promise<boolean>
  notify(input: NotificationInput): Promise<void>
}

export type UpdateStatus = 'disabled' | 'up-to-date' | 'available'

export interface UpdateCheckResult {
  readonly status: UpdateStatus
  readonly version: string | null
}

export interface UpdateAdapter {
  readonly enabled: boolean
  check(): Promise<UpdateCheckResult>
}

export interface AdapterBundle {
  readonly platform: 'tauri' | 'web'
  readonly secrets: SecretStoreAdapter
  readonly deepLinks: DeepLinkAdapter
  readonly fileDialog: FileDialogAdapter
  readonly notifications: NotificationAdapter
  readonly updates: UpdateAdapter
}
