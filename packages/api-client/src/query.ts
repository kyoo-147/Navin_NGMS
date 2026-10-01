export type QueryPrimitive = string | number | boolean
export type QueryValue = QueryPrimitive | null | undefined
export type QueryParams = Readonly<Record<string, QueryValue | readonly QueryPrimitive[]>>

export function buildQueryString(query?: QueryParams): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
    } else {
      params.append(key, String(value))
    }
  }
  return params.toString()
}
