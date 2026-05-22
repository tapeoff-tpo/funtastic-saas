# GS Shop RPA

Base URL: `https://withgs.gsshop.com`
Login URL: `https://withgs.gsshop.com/cmm/login`

## Current scope

- Login/session validation is wired through the common scraper worker.
- Credentials should be saved as RPA login ID/password from marketplace settings.
- Order collection intentionally stops with a clear `501` message until the actual order list or Excel download screen is confirmed.

## Next implementation target

1. Confirm the order list URL after logging in to WithGS.
2. Identify the date filters and status filters for new/preparing orders.
3. Prefer Excel download parsing if WithGS provides an order Excel button.
4. Add invoice upload RPA after the order detail or bulk invoice upload screen is confirmed.
