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

## Production deployment

Cloudflare Pages project `tinycloud-explorer` serves `explorer.tinycloud.xyz`.
`.github/workflows/deploy.yml` builds and deploys `dist` on pushes to `main`
or a manual dispatch from `main`. The `production` GitHub environment must
allow deployments only from `main`; set its `CLOUDFLARE_API_TOKEN` secret to a
token with Pages:Edit for the project account, and its
`CLOUDFLARE_ACCOUNT_ID` variable to that account ID. The workflow uses the
triggering commit SHA and serializes production deployments. PRs run the
`Explorer CI / verify` check (typecheck, unit tests, production build).

The lockfile currently fetches private `@tinycloud/styles` over Git SSH.
GitHub-hosted runners cannot install it without approved access. Do not
weaken the required CI check or expose a private key to public-repository
pull requests; resolve the styles package distribution and license decision
before enabling automatic merges or relying on unattended deployments.

## Real Fixture

```sh
VITE_TINYCLOUD_HOST=https://node.tinycloud.xyz VITE_TINYCLOUD_KV_PREFIX="" bun run fixture:seed
VITE_TINYCLOUD_HOST=https://node.tinycloud.xyz VITE_TINYCLOUD_KV_PREFIX="" bun run fixture:verify
VITE_TINYCLOUD_SPACE_PREFIX=applications VITE_TINYCLOUD_KV_PREFIX="" bun run test:e2e:real
```

For a manual CLI proof, start the real development server:

```sh
VITE_EXPLORER_DATA_SOURCE=real \
VITE_TINYCLOUD_HOST=https://node.tinycloud.xyz \
VITE_TINYCLOUD_SPACE_PREFIX=applications \
VITE_TINYCLOUD_KV_PREFIX="" \
VITE_TINYCLOUD_SESSION_PREFIX=tinycloud-explorer-agent-browser \
bun run dev --host 127.0.0.1 --port 4188
```

Then bootstrap the public deterministic fixture wallet in a fresh
`agent-browser` session and connect through the visible Explorer UI:

```sh
agent-browser --session tinycloud-explorer open http://127.0.0.1:4188
agent-browser --session tinycloud-explorer eval \
  '(async()=>{const {installAgentBrowserWallet}=await import("/e2e/agent-browser-wallet.ts");return installAgentBrowserWallet()})()'
agent-browser --session tinycloud-explorer snapshot -i
agent-browser --session tinycloud-explorer click @e1
```

The helper is served only by the Vite development server. Production builds
ignore the development-only OpenKey test hook and use `OpenKey.connect()`
normally. Continue with `snapshot`, `click`, `get text`, and `screenshot` to
traverse `public`, `applications`, `account`, and `secrets`; grant account
discovery when prompted, run a SQL query, inspect the encrypted secret
envelopes, and check `console` plus Explorer's debug log for discovery
failures.

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
