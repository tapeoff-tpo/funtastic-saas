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
import { TobizonScraper } from './tobizon/scraper'
import { BananaB2bScraper } from './banana-b2b/scraper'
import { DomesinScraper } from './domesin/scraper'
// import { AblyScraper } from './ably/scraper'
// import { OhouseScraper } from './ohouse/scraper'

registerScraper(new DomechangoScraper())
registerScraper(new OnchannelScraper())
registerScraper(new TobizonScraper())
registerScraper(new BananaB2bScraper())
registerScraper(new DomesinScraper())
// registerScraper(new AblyScraper())
// registerScraper(new OhouseScraper())
