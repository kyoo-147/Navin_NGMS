import type { FileDialogOptions } from './types'

const EXTENSION_PATTERN = /^[a-z0-9]{1,12}$/u
const MAX_TITLE_LENGTH = 120
const MAX_FILTERS = 16

export function normalizeFileDialogOptions(options: FileDialogOptions = {}): FileDialogOptions {
  const title = options.title?.trim()
  if (title !== undefined && (title.length === 0 || title.length > MAX_TITLE_LENGTH)) {
    throw new Error('file dialog title must be 1..120 characters')
  }

  const filters = options.filters ?? []
  if (filters.length > MAX_FILTERS) {
    throw new Error(`file dialog accepts at most ${MAX_FILTERS} filters`)
  }

  const normalizedFilters = filters.map((filter) => {
    const name = filter.name.trim()
    if (name.length === 0 || name.length > MAX_TITLE_LENGTH) {
      throw new Error('file dialog filter name must be 1..120 characters')
    }
    const extensions = filter.extensions.map((extension) =>
      extension.trim().toLowerCase().replace(/^\./u, ''),
    )
    if (extensions.length === 0) {
      throw new Error(`file dialog filter "${name}" needs at least one extension`)
    }
    for (const extension of extensions) {
      if (!EXTENSION_PATTERN.test(extension)) {
        throw new Error(`file dialog filter "${name}" has an unsafe extension "${extension}"`)
      }
    }
    return { name, extensions }
  })

  return { title, filters: normalizedFilters }
}
