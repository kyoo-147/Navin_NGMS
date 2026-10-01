import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { validateTokensSchema } from './schema.js'
import { generateTokensCss } from './css.js'
import { generateTokensTs } from './ts.js'
import { generateTailwindTheme } from './tailwind.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function runGenerator(
  customTokensPath?: string,
  outDir?: string,
): {
  cssPath: string
  tsPath: string
  tailwindPath: string
} {
  const defaultTokensPath = path.resolve(__dirname, '../../../../docs/design/navin-tokens.json')
  const tokensPath = customTokensPath || defaultTokensPath

  if (!fs.existsSync(tokensPath)) {
    throw new Error(`Canonical tokens file not found at: ${tokensPath}`)
  }

  const rawJson = JSON.parse(fs.readFileSync(tokensPath, 'utf8'))
  const tokens = validateTokensSchema(rawJson)

  const targetDir = outDir || path.resolve(__dirname, '../generated')
  fs.mkdirSync(targetDir, { recursive: true })

  const cssContent = generateTokensCss(tokens)
  const tsContent = generateTokensTs(tokens)
  const tailwindContent = generateTailwindTheme(tokens)

  const cssPath = path.join(targetDir, 'tokens.css')
  const tsPath = path.join(targetDir, 'tokens.ts')
  const tailwindPath = path.join(targetDir, 'tailwind-theme.ts')

  fs.writeFileSync(cssPath, cssContent, 'utf8')
  fs.writeFileSync(tsPath, tsContent, 'utf8')
  fs.writeFileSync(tailwindPath, tailwindContent, 'utf8')

  console.log(`[navin-tokens] Successfully generated tokens from ${tokensPath}`)
  console.log(`[navin-tokens] -> ${cssPath} (${Buffer.byteLength(cssContent, 'utf8')} bytes)`)
  console.log(`[navin-tokens] -> ${tsPath} (${Buffer.byteLength(tsContent, 'utf8')} bytes)`)
  console.log(
    `[navin-tokens] -> ${tailwindPath} (${Buffer.byteLength(tailwindContent, 'utf8')} bytes)`,
  )

  return { cssPath, tsPath, tailwindPath }
}

// Direct CLI invocation
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runGenerator()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[navin-tokens] Generation failed: ${message}`)
    process.exit(1)
  }
}
