import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..', '..')

describe('local market agent startup', () => {
  it('starts through the local agent runner so API and RPA queues are both handled', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts['agent:start']).toBe(
      'node --env-file=.env.local scripts/local-agent-runner.mjs',
    )
    expect(fs.existsSync(path.join(root, 'scripts', 'local-agent-runner.mjs'))).toBe(true)
  })

  it('disables automatic repeat collection schedules for the local agent', () => {
    const runner = fs.readFileSync(path.join(root, 'scripts', 'local-agent-runner.mjs'), 'utf8')
    const worker = fs.readFileSync(path.join(root, 'src', 'worker.ts'), 'utf8')

    expect(runner).toContain('DISABLE_AUTO_COLLECTION_SCHEDULE')
    expect(worker).toContain('process.env.DISABLE_AUTO_COLLECTION_SCHEDULE')
  })
})
