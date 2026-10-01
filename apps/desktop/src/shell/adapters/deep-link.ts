import { DeepLinkRejectedError } from '../errors'

export const NAVIN_DEEP_LINK_SCHEME = 'navin:'

export type DeepLinkAction =
  | { readonly kind: 'open-surface'; readonly surface: 'mail' | 'control' }
  | { readonly kind: 'oauth-callback'; readonly code: string; readonly state: string }

const SURFACE_MODULES: ReadonlySet<string> = new Set(['mail', 'control'])

/**
 * Deep links are an untrusted input surface (any local process or page can open
 * a registered scheme). Parse into a small closed set of typed actions and
 * reject everything else, so a URL can never inject an arbitrary path or host.
 */
export function parseDeepLink(url: string): DeepLinkAction {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new DeepLinkRejectedError('invalid_url', `Not a valid deep link: "${url}"`)
  }

  if (parsed.protocol !== NAVIN_DEEP_LINK_SCHEME) {
    throw new DeepLinkRejectedError(
      'scheme_not_permitted',
      `Unsupported deep-link scheme "${parsed.protocol}"`,
    )
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new DeepLinkRejectedError('userinfo_present', 'deep links must not embed credentials')
  }
  if (parsed.hash !== '') {
    throw new DeepLinkRejectedError('fragment_present', 'deep links must not include a fragment')
  }

  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.replace(/\/+$/u, '')

  if (host === 'open') {
    const surface = path.replace(/^\//u, '')
    if (!SURFACE_MODULES.has(surface) || parsed.search !== '') {
      throw new DeepLinkRejectedError('unknown_open_target', `Unsupported open target "${path}"`)
    }
    return { kind: 'open-surface', surface: surface as 'mail' | 'control' }
  }

  if (host === 'oauth') {
    if (path !== '/callback') {
      throw new DeepLinkRejectedError('unknown_oauth_path', `Unsupported oauth path "${path}"`)
    }
    const code = parsed.searchParams.get('code')?.trim() ?? ''
    const state = parsed.searchParams.get('state')?.trim() ?? ''
    if (code === '' || state === '') {
      throw new DeepLinkRejectedError(
        'missing_oauth_params',
        'oauth callback requires code and state',
      )
    }
    return { kind: 'oauth-callback', code, state }
  }

  throw new DeepLinkRejectedError('unknown_host', `Unsupported deep-link host "${host}"`)
}
