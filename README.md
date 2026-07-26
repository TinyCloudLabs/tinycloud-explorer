# TinyCloud Explorer

TinyCloud Explorer is a spatial, evidence-aware browser for TinyCloud spaces,
SQL resources, and key-value data.

The current milestone is an interactive Option A wireframe: a persistent space
rail, JSON Canvas map, resource inspector, and authorization-evidence footer.
It runs against a typed fixture data source so the complete user flow can be
reviewed before the real TinyCloud adapter is connected.

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
- `src/data/fixtureDataSource.ts` powers the reviewable wireframe.
- `src/components/CartographCanvas.tsx` projects discovered resources into a
  JSON Canvas-compatible spatial model.
- SQL and KV resources open in purpose-built readers while preserving the
  account → space → resource context.

The live adapter will use `TinyCloudWeb`, account space discovery,
`sqlForSpace()`, and `kvForSpace()` without changing the UI contract.
