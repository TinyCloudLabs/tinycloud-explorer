# TinyCloud Explorer

TinyCloud Explorer is a spatial, evidence-aware browser for TinyCloud spaces,
SQL resources, and key-value data.

The current milestone includes a persistent space rail, JSON Canvas map,
resource inspector, authorization-evidence footer, and adapters for both the
real TinyCloud SDK and seeded `@tinycloud/sdk-services-test` data.

## Develop

```sh
bun install
bun run dev
```

## Verify

```sh
bun run check
bun run test
bun run test:e2e
bun run build
```

## Architecture

- `src/data/ExplorerDataSource.ts` defines the integration boundary.
- `src/data/sdkMockSeed.ts` contains dummy spaces, SQL rows, KV values, and
  capability states.
- `src/data/sdkMockDataSource.ts` loads and mutates that data through the SDK's
  in-memory `MockKVService`.
- `src/components/CartographCanvas.tsx` projects discovered resources into a
  JSON Canvas-compatible spatial model.
- SQL and KV resources open in purpose-built readers while preserving the
  account → space → resource context.

Known resources can be listable and describable without being readable. The
mock exposes those resources as `needs-permission`, conceals their contents,
and uses `MockKVService.put()` to model granting read permission.

The live adapter uses `TinyCloudWeb`, account space discovery, `sqlForSpace()`,
and `kvForSpace()`. OpenKey's first prompt connects a wallet identity and gives
TinyCloud a signing provider. TinyCloud's following SIWE prompt contains the
Explorer capability grant. Additional space discovery requests are read-only:
capability discovery, KV get/list/metadata, and SQL read.

## Vendored SDK mock

`vendor/sdk-services-test` is the published
`@tinycloud/sdk-services-test@13.0.0` build. The published package currently
contains `workspace:*` dependency metadata and extensionless ESM imports, so it
cannot be installed directly by Bun or npm outside the SDK monorepo. The
vendored copy changes only those packaging details and can be removed once a
consumable package is published.
