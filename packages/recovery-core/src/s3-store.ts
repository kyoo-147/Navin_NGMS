import { createHash, createHmac } from 'node:crypto'
import type { S3CompatibleConfig, S3CompatibleObjectStorePort } from './types.js'

function rawAuthorityHost(authority: string): string {
  if (authority.length === 0 || authority.includes('@')) {
    throw new Error('S3 endpoint must not contain credentials or an empty host')
  }
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end < 0) throw new Error('S3 endpoint contains an invalid IPv6 host')
    const host = authority.slice(0, end + 1)
    const suffix = authority.slice(end + 1)
    if (suffix.length > 0 && !/^:\d+$/.test(suffix)) {
      throw new Error('S3 endpoint contains an invalid port')
    }
    return host
  }
  const separator = authority.lastIndexOf(':')
  if (separator >= 0) {
    const host = authority.slice(0, separator)
    const port = authority.slice(separator + 1)
    if (host.length === 0 || !/^\d+$/.test(port)) {
      throw new Error('S3 endpoint contains an invalid port')
    }
    return host
  }
  return authority
}

function validatePath(path: string, label: string): void {
  if (path.length === 0) return
  if (
    /[\\?#]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) <= 0x20) ||
    /%(?:2e|2f|5c|3f|23)/i.test(path)
  ) {
    throw new Error(`Unsafe ${label}: ${path}`)
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    throw new Error(`Malformed ${label}: ${path}`)
  }
  if (decoded.includes('\\') || decoded.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error(`Traversal is not allowed in ${label}: ${path}`)
  }
  if (path.startsWith('//') || path.includes('://')) {
    throw new Error(`Ambiguous ${label}: ${path}`)
  }
}

export function parseS3Endpoint(raw: string): URL {
  if (raw.trim() !== raw || [...raw].some((character) => character.charCodeAt(0) <= 0x20)) {
    throw new Error('S3 endpoint must be an absolute URL without whitespace')
  }
  const match = /^(https?):\/\/([^/?#]*)([^?#]*)?(?:[?#].*)?$/i.exec(raw)
  if (!match) throw new Error(`S3 endpoint must be an absolute HTTP(S) URL: ${raw}`)
  const scheme = match[1]?.toLowerCase()
  const authority = match[2] ?? ''
  const rawHost = rawAuthorityHost(authority)
  const rawPath = match[3] ?? ''
  validatePath(rawPath, 'S3 endpoint path')

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid S3 endpoint: ${raw}`)
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('S3 endpoint must not contain credentials, query parameters, or a hash')
  }
  if (parsed.protocol !== `${scheme}:`) {
    throw new Error(`Unsupported S3 endpoint scheme: ${parsed.protocol}`)
  }

  const normalizedRawHost = rawHost.toLowerCase()
  const normalizedParsedHost = parsed.hostname.toLowerCase()
  if (normalizedRawHost !== normalizedParsedHost && /^\d/.test(rawHost)) {
    throw new Error('S3 endpoint host uses an ambiguous numeric representation')
  }
  if (/^0x[0-9a-f]+$/i.test(normalizedRawHost) || /^\d+$/.test(normalizedRawHost)) {
    throw new Error('S3 endpoint host uses an ambiguous numeric representation')
  }
  const parts = normalizedRawHost.split('.')
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    if (parts.some((p) => p.length > 1 && p.startsWith('0'))) {
      throw new Error('S3 endpoint host uses an ambiguous numeric representation')
    }
  }

  if (normalizedRawHost === 'localhost' || normalizedRawHost.endsWith('.localhost')) {
    throw new Error('S3 endpoint must not use an ambiguous localhost hostname')
  }
  if (
    parsed.protocol === 'http:' &&
    normalizedRawHost !== '127.0.0.1' &&
    normalizedRawHost !== '[::1]'
  ) {
    throw new Error('Refusing insecure HTTP S3 endpoint; only literal loopback IPs are allowed')
  }
  return parsed
}

export class S3CompatibleObjectStore implements S3CompatibleObjectStorePort {
  readonly provider = 's3-compatible' as const
  private readonly endpoint: string
  private readonly bucket: string
  private readonly region: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly forcePathStyle: boolean
  private readonly fetch: typeof globalThis.fetch

  constructor(config: S3CompatibleConfig) {
    if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
      throw new Error(
        'S3CompatibleObjectStore requires endpoint, bucket, accessKeyId, and secretAccessKey',
      )
    }
    parseS3Endpoint(config.endpoint)
    this.endpoint = config.endpoint.replace(/\/+$/, '')
    this.bucket = config.bucket
    this.region = config.region ?? 'us-east-1'
    this.accessKeyId = config.accessKeyId
    this.secretAccessKey = config.secretAccessKey
    this.forcePathStyle = config.forcePathStyle ?? true
    this.fetch = config.fetchFn ?? globalThis.fetch.bind(globalThis)
  }

  async putImmutable(key: string, value: Uint8Array): Promise<'created' | 'exists'> {
    // Check if object already exists
    try {
      const headResponse = await this.request('HEAD', key)
      if (headResponse.status === 200) {
        return 'exists'
      }
    } catch {
      // Ignore head failures and proceed to put
    }

    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'if-none-match': '*',
    }
    const response = await this.request('PUT', key, value, headers)
    if (response.status === 200 || response.status === 201 || response.status === 204) {
      return 'created'
    }
    if (response.status === 412 || response.status === 409) {
      return 'exists'
    }
    const errorText = await response.text().catch(() => '')
    throw new Error(`S3 PUT failed with status ${response.status}: ${errorText}`)
  }

  async get(key: string): Promise<Uint8Array> {
    const response = await this.request('GET', key)
    if (response.status === 404) {
      throw new Error(`S3 object not found: ${key}`)
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`S3 GET failed with status ${response.status}: ${errorText}`)
    }
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  }

  async list(prefix = ''): Promise<string[]> {
    const query = new URLSearchParams()
    query.set('list-type', '2')
    if (prefix.length > 0) {
      query.set('prefix', prefix)
    }
    const response = await this.request('GET', '', undefined, undefined, query)
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`S3 LIST failed with status ${response.status}: ${errorText}`)
    }
    const xml = await response.text()
    const keys: string[] = []
    const keyRegex = /<Key>([^<]+)<\/Key>/g
    let match: RegExpExecArray | null
    while ((match = keyRegex.exec(xml)) !== null) {
      if (match[1]) keys.push(match[1])
    }
    return keys.sort()
  }

  async delete(key: string): Promise<void> {
    const response = await this.request('DELETE', key)
    if (response.status === 200 || response.status === 204 || response.status === 404) {
      return
    }
    const errorText = await response.text().catch(() => '')
    throw new Error(`S3 DELETE failed with status ${response.status}: ${errorText}`)
  }

  private async request(
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
    key: string,
    body?: Uint8Array,
    customHeaders: Record<string, string> = {},
    queryParams?: URLSearchParams,
  ): Promise<Response> {
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)

    const normalizedKey = key.replace(/^\/+/, '')
    let urlStr: string
    let host: string
    const endpointUrl = new URL(this.endpoint)

    if (this.forcePathStyle) {
      host = endpointUrl.host
      const path =
        normalizedKey.length > 0 ? `/${this.bucket}/${encodeURI(normalizedKey)}` : `/${this.bucket}`
      urlStr = `${this.endpoint}${path}`
    } else {
      host = `${this.bucket}.${endpointUrl.host}`
      const path = normalizedKey.length > 0 ? `/${encodeURI(normalizedKey)}` : '/'
      urlStr = `${endpointUrl.protocol}//${host}${path}`
    }

    if (queryParams && queryParams.toString().length > 0) {
      urlStr += `?${queryParams.toString()}`
    }

    const payloadHash = body ? sha256(body) : sha256(new Uint8Array(0))
    const headers: Record<string, string> = {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      ...customHeaders,
    }

    // SigV4 Signing
    const signedHeaders = Object.keys(headers)
      .map((k) => k.toLowerCase())
      .sort()
      .join(';')

    const canonicalHeaders = Object.keys(headers)
      .map((k) => k.toLowerCase())
      .sort()
      .map((k) => `${k}:${headers[k]?.trim()}\n`)
      .join('')

    const canonicalUri = new URL(urlStr).pathname
    const canonicalQuery = queryParams
      ? Array.from(queryParams.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : ''

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256(new TextEncoder().encode(canonicalRequest)),
    ].join('\n')

    const signingKey = getSignatureKey(this.secretAccessKey, dateStamp, this.region, 's3')
    const signature = hmac(signingKey, stringToSign, 'hex')

    headers['authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    const requestInit: RequestInit = {
      method,
      headers,
    }
    if (body && method === 'PUT') {
      requestInit.body = body
    }

    return this.fetch(urlStr, requestInit)
  }
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Uint8Array | string, message: string, encoding: 'hex'): string
function hmac(key: Uint8Array | string, message: string): Uint8Array
function hmac(key: Uint8Array | string, message: string, encoding?: 'hex'): string | Uint8Array {
  const h = createHmac('sha256', key).update(message)
  return encoding === 'hex' ? h.digest('hex') : new Uint8Array(h.digest())
}

function getSignatureKey(
  key: string,
  dateStamp: string,
  regionName: string,
  serviceName: string,
): Uint8Array {
  const kDate = hmac(`AWS4${key}`, dateStamp)
  const kRegion = hmac(kDate, regionName)
  const kService = hmac(kRegion, serviceName)
  return hmac(kService, 'aws4_request')
}
