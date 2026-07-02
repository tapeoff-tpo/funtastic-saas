import { spawn } from 'node:child_process'

const children = []

function start(name, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`)
  })
  child.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`
    console.log(`[local-agent] ${name} exited with ${reason}`)
    if (!shuttingDown) shutdown(code ?? 1)
  })

  children.push(child)
}

let shuttingDown = false

async function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  console.log('[local-agent] stopping workers...')

  for (const child of children) {
    if (!child.killed) child.kill('SIGINT')
  }

  setTimeout(() => process.exit(exitCode), 5000).unref()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('[local-agent] starting API worker and RPA worker')
start('api-worker', ['--import', 'tsx', 'src/worker.ts'], {
  DISABLE_AUTO_COLLECTION_SCHEDULE: 'true',
})
start('rpa-worker', ['--import', 'tsx', 'src/scrapers/worker.ts'])
