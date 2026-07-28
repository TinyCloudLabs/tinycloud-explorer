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
and `kvForSpace()`. OpenKey selects the signing wallet, then one TinyCloud SIWE
both authenticates the wallet and grants Explorer's initial capabilities.
Explorer does not eagerly host or create spaces during sign-in. Additional
space discovery requests are read-only: capability discovery, KV
get/list/metadata, and SQL read.

## Debug logging

Use the log button in the Explorer header to inspect the current session's
connection, discovery, permission, and invocation events. The panel keeps the
latest 300 events in memory and supports copying a timestamped text log for a
bug report. Authorization headers, bearer tokens, SIWE messages, signatures,
private keys, secret fields, and stored values are redacted before an event is
published to either the panel or the browser console.

## Vendored SDK mock

`vendor/sdk-services-test` is the published
`@tinycloud/sdk-services-test@13.0.0` build. The published package currently
contains `workspace:*` dependency metadata and extensionless ESM imports, so it
cannot be installed directly by Bun or npm outside the SDK monorepo. The
vendored copy changes only those packaging details and can be removed once a
consumable package is published.
