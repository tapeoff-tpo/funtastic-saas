import { SCRAPER_WORKER_CONCURRENCY } from '@/scrapers/worker-config'

describe('scraper worker config', () => {
  it('runs one RPA job at a time because scrapers share a browser instance', () => {
    expect(SCRAPER_WORKER_CONCURRENCY).toBe(1)
  })
})
