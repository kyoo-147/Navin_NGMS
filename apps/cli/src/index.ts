#!/usr/bin/env node
import { runCli } from './cli.js'

export * from './cli.js'
export * from './client.js'
export * from './config.js'
export * from './format.js'

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('navin') ||
  process.argv[1]?.endsWith('navin.js') ||
  process.argv[1]?.endsWith('index.js')
) {
  const result = await runCli(process.argv.slice(2))
  if (result.output) {
    if (result.exitCode === 0) {
      console.log(result.output)
    } else {
      console.error(result.output)
    }
  }
  process.exit(result.exitCode)
}
