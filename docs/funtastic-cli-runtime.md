# FUN-TASTIC CLI Runtime

Verified: 2026-07-17

## Requirements

- Node.js 22 or newer (`.nvmrc` is `22`)
- npm compatible with `package-lock.json`
- Network access for Funtastic B2B lookup and image download
- PostgreSQL network access when `opportunities` reads the database directly

## Install

```bash
git clone https://github.com/tapeoff-tpo/funtastic-saas.git
cd funtastic-saas
npm ci
npm run funtastic -- --help
```

Optional global command:

```bash
npm link
funtastic opportunities --help
```

## Private Inputs

### Database mode

Create `.env.local` or export:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

`opportunities` does not call the SaaS HTTP snapshot API automatically. Without
`--input`, it connects directly to PostgreSQL through the application data layer.

### Snapshot mode

Use a private local JSON file with the Opportunity source shape:

```bash
npm run funtastic -- opportunities \
  --input /private/path/opportunities-source.json \
  --output /private/path/opportunities
```

The generated `source_snapshot.json` contains internal product and monthly sales
data. Keep it outside Git. The repository ignores `opportunities/`, numeric SKU
directories under `products/`, and `docs/product-research/`.

## Pipeline Inputs

```bash
npm run funtastic -- discover SKU \
  --snapshot /private/path/opportunities/current/source_snapshot.json \
  --output /private/path/products
```

`concepts` additionally requires a manually authored file:

```text
/private/path/products/<SKU>/concepts/concepts-input.json
```

`council` requires the discovery package and the same concept input. It does not
currently call an LLM, MCP server, or the FUN-TASTIC OS Agent engine.

## Platform Notes

The four tracked commands use Node.js APIs and contain no hardcoded macOS path.
They should be portable to Linux and Windows under Node 22, but this audit only
executed them on macOS. CAD, Blender, Bambu Studio, Keychain, and printer tooling
are outside these four CLI commands and have separate platform dependencies.
