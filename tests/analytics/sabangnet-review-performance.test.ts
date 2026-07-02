import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..', '..')

describe('sabangnet review page performance guards', () => {
  it('loads review lines with server-side status filtering and a small display limit', () => {
    const page = fs.readFileSync(
      path.join(root, 'src', 'app', '(auth)', 'analytics', 'sabangnet-review', 'page.tsx'),
      'utf8',
    )

    expect(page).toContain('const REVIEW_LINE_DISPLAY_LIMIT = 300')
    expect(page).toContain('status: selectedStatus')
    expect(page).toContain('limit: REVIEW_LINE_DISPLAY_LIMIT')
    expect(page).not.toContain('lines.filter((line) => line.reviewStatus === selectedStatus)')
  })

  it('does not fetch ten thousand review lines for every page switch', () => {
    const analytics = fs.readFileSync(
      path.join(root, 'src', 'lib', 'analytics', 'sabangnet-review.ts'),
      'utf8',
    )

    expect(analytics).not.toContain('LIMIT 10000')
    expect(analytics).toContain('AND review_status = ${options.status}')
    expect(analytics).toContain('Math.min(Math.floor(options.limit ?? 300), 500)')
  })
})
