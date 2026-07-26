# TinyCloud Explorer

TinyCloud Explorer is a spatial, evidence-aware browser for TinyCloud spaces,
SQL resources, and key-value data.

The current milestone is an interactive wireframe: a persistent space rail,
JSON Canvas map, resource inspector, and authorization-evidence footer. It runs
against seeded `@tinycloud/sdk-services-test` data so the complete user flow can
be reviewed before the real TinyCloud adapter is connected.

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

The live adapter will use `TinyCloudWeb`, account space discovery,
`sqlForSpace()`, and `kvForSpace()` without changing the UI contract.

## Vendored SDK mock

`vendor/sdk-services-test` is the published
`@tinycloud/sdk-services-test@13.0.0` build. The published package currently
contains `workspace:*` dependency metadata and extensionless ESM imports, so it
cannot be installed directly by Bun or npm outside the SDK monorepo. The
vendored copy changes only those packaging details and can be removed once a
consumable package is published.
