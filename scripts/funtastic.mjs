#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const commands = {
  opportunities: 'funtastic-opportunities.ts',
  discover: 'funtastic-discover.ts',
  concepts: 'funtastic-concepts.ts',
  council: 'funtastic-council.ts',
}

const [command, ...args] = process.argv.slice(2)

if (!command || command === '-h' || command === '--help') {
  usage()
  process.exit(0)
}

if (!(command in commands)) {
  console.error(`Unknown command: ${command}`)
  usage()
  process.exit(2)
}

const nodeArgs = []
const envFile = resolve(projectRoot, '.env.local')
if (existsSync(envFile)) nodeArgs.push(`--env-file=${envFile}`)
nodeArgs.push('--import', 'tsx', resolve(scriptDirectory, commands[command]), ...args)

const result = spawnSync(process.execPath, nodeArgs, {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`Unable to run funtastic ${command}: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)

function usage() {
  console.log(`Usage:
  funtastic opportunities [OPTIONS]
  funtastic discover SKU [OPTIONS]
  funtastic concepts SKU [OPTIONS]
  funtastic council SKU [OPTIONS]

From a fresh clone:
  npm run funtastic -- opportunities --help

Optional global command:
  npm link
  funtastic opportunities --help
`)
}
