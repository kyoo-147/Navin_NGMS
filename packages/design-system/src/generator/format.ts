export function formatJsString(str: string): string {
  // JSON.stringify safely handles control characters, newlines, tabs, and backslashes
  const json = JSON.stringify(str)
  const inner = json.slice(1, -1)
  const escaped = inner.replace(/\\"/g, '"').replace(/'/g, "\\'")
  return `'${escaped}'`
}

export function formatJsValue(val: unknown, indent = 0): string {
  const pad = ' '.repeat(indent)
  const innerPad = ' '.repeat(indent + 2)

  if (typeof val === 'string') {
    return formatJsString(val)
  }

  if (typeof val === 'number') {
    return String(val)
  }

  if (typeof val === 'object' && val !== null) {
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]'
      const lines = val.map((item) => `${innerPad}${formatJsValue(item, indent + 2)},`)
      return `[\n${lines.join('\n')}\n${pad}]`
    }

    const entries = Object.entries(val)
    if (entries.length === 0) return '{}'
    const lines = entries.map(([k, v]) => {
      const keyStr = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : `'${k}'`
      return `${innerPad}${keyStr}: ${formatJsValue(v, indent + 2)},`
    })
    return `{\n${lines.join('\n')}\n${pad}}`
  }

  return String(val)
}
