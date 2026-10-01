import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

import type { ObjectStorePort } from './types.js'

export class FilesystemObjectStore implements ObjectStorePort {
  constructor(readonly root: string) {}

  async putImmutable(key: string, value: Uint8Array): Promise<'created' | 'exists'> {
    const destination = this.pathFor(key)
    await mkdir(dirname(destination), { recursive: true })
    try {
      await stat(destination)
      return 'exists'
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    const temporary = `${destination}.tmp-${randomUUID()}`
    await writeFile(temporary, value, { flag: 'wx' })
    try {
      await rename(temporary, destination)
      return 'created'
    } catch (error) {
      await rm(temporary, { force: true })
      if (isExists(error)) return 'exists'
      throw error
    }
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(key)))
  }

  async list(prefix = ''): Promise<string[]> {
    await mkdir(this.root, { recursive: true })
    const names = await readdir(this.root, { recursive: true })
    const results: string[] = []
    for (const name of names) {
      if (name.includes('.tmp-')) continue
      const fullPath = join(this.root, name)
      try {
        const fileStat = await stat(fullPath)
        if (fileStat.isFile()) {
          const key = name.split(sep).join('/')
          if (key.startsWith(prefix)) {
            results.push(key)
          }
        }
      } catch {
        // file may have been removed concurrently
      }
    }
    return results.sort()
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  private pathFor(key: string): string {
    if (key.length === 0 || isAbsolute(key))
      throw new Error('Object key must be a relative non-empty path')
    const resolved = join(this.root, key)
    const escaped =
      relative(this.root, resolved).startsWith(`..${sep}`) || relative(this.root, resolved) === '..'
    if (escaped) throw new Error('Object key escapes the object-store root')
    return resolved
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function isExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
}
