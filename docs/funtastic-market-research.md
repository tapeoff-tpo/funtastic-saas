# FUN-TASTIC Market Intelligence

`funtastic research <sku>` normalizes human-supplied market evidence. It does
not crawl the web, infer customer problems from prose, create competitors, or
generate product concepts.

## Run

```bash
npm run funtastic -- research 101518-0001 --products /private/path/products
```

The command requires these Discover outputs:

```text
products/<sku>/discovery/current/
  internal-product.json
  official-product.json
  physical-evidence.json
  discovery-status.json
```

## Optional input

Place any of the following directly in `products/<sku>/research/`:

```text
reviews.csv
competitor-urls.csv
amazon-links.csv
taobao-links.csv
reddit.md
notes.md
```

Missing optional files do not fail the command. Recommended `reviews.csv`
columns are `review_id`, `review`, `rating`, `date`, `channel`, `url`,
`problem`, and `use_case`. Customer problems and use cases are counted only
from the explicit `problem` and `use_case` fields. Review prose is retained as
evidence but is not interpreted.

Recommended competitor columns are `url`, `brand`, `product_name`, `price`,
`currency`, `country`, `mounting_method`, `material`, `features`, and
`differentiation`. Only HTTP or HTTPS URLs are accepted. A premium brand must
be explicitly marked with `premium_brand` or `is_premium`/`premium`.

## Output and history

Each run writes seven files to both a preserved run and `current`:

```text
products/<sku>/research/
  runs/<timestamp>/
  current/
    market-evidence.json
    competitors.json
    customer-problems.json
    customer-use-cases.json
    premium-brands.json
    research-status.json
    research-report.md
```

Input files remain in the research root and are never overwritten.

## Status

- `empty`: no unique reviews and no valid competitor URLs
- `reviews-loaded`: one or more unique reviews, no valid competitors
- `competitors-loaded`: one or more valid competitors, no reviews
- `market-evidence-ready`: both unique reviews and valid competitors

Notes and Reddit Markdown alone do not advance status because they are
unstructured evidence. `market-evidence-ready` means evidence was normalized;
it does not mean market conclusions or concepts were generated.
