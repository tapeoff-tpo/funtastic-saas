/**
 * Scraper registration.
 *
 * Side-effect import — adding a new scraper:
 *   1. Build the scraper class implementing MarketplaceScraper
 *   2. Import it here
 *   3. Call registerScraper(new YourScraper())
 *
 * The scraper-worker imports this file once at boot to populate the registry.
 */

import { registerScraper } from './registry'
import { DomechangoScraper } from './domechango/scraper'
import { OnchannelScraper } from './onchannel/scraper'
// import { AblyScraper } from './ably/scraper'
// import { OhouseScraper } from './ohouse/scraper'

registerScraper(new DomechangoScraper())
registerScraper(new OnchannelScraper())
// registerScraper(new AblyScraper())
// registerScraper(new OhouseScraper())
