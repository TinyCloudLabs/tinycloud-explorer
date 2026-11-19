// Shared fakes for the embedded-session tests: a fake One frame (controller +
// session-only tcw) that hands out real `serializeDelegation`-shaped JSON.
import { vi } from "vitest";
import { buildSpaceUri } from "@tinycloud/sdk-core";
import type { EmbeddedSessionConfig } from "./embeddedSession";
import type {
  EmbedGrant,
  EmbedRequestResult,
  OneEmbedControllerOptions,
} from "./oneEmbed";

export const OWNER = "0x1111111111111111111111111111111111111111";
export const OWNER_DID = `did:pkh:eip155:1:${OWNER}`;
export const spaceOf = (name: string, owner = OWNER) =>
  buildSpaceUri(`did:pkh:eip155:1:${owner}`, name);

/** What One sends: `serializeDelegation` output is JSON of the portable delegation. */
export function serializedDelegation(
  spaceId: string,
  actions: string[],
  owner = OWNER,
): string {
  return JSON.stringify({
    cid: `bafy-${spaceId.split(":").at(-1)}`,
    spaceId,
    path: "",
    actions,
    expiry: "2030-01-01T00:00:00.000Z",
    ownerAddress: owner,
    chainId: 1,
  });
}

export function grantOf(
  entries: Array<{ spaceId: string; actions: string[]; owner?: string }>,
  theme: "light" | "dark" = "dark",
): EmbedGrant {
  return {
    nonce: "n",
    grants: entries.map((entry) => ({
      spaceId: entry.spaceId,
      delegation: serializedDelegation(entry.spaceId, entry.actions, entry.owner),
      cid: "cid",
    })),
    expiresAt: 1_900_000_000_000,
    theme,
  };
}

export function makeKv() {
  return {
    list: vi.fn(async () => ({ ok: true, data: { keys: [], truncated: false } })),
    get: vi.fn(async () => ({ ok: true, data: { data: "x", headers: {} } })),
    put: vi.fn(async () => ({ ok: true, data: { data: undefined, headers: {} } })),
    delete: vi.fn(async () => ({ ok: true, data: { data: undefined, headers: {} } })),
  };
}

export function makeFakeFrame() {
  let options: OneEmbedControllerOptions | null = null;
  const controller = {
    start: vi.fn(),
    repeatHello: vi.fn(),
    stop: vi.fn(),
    request: vi.fn(
      async (): Promise<EmbedRequestResult> => ({ kind: "denied" }),
    ),
  };
  const kvBySpace = new Map<string, ReturnType<typeof makeKv>>();
  const tcw = {
    sessionDid: "did:key:z6MkSession",
    useDelegation: vi.fn(async (delegation: { spaceId: string }) => {
      const kv = kvBySpace.get(delegation.spaceId) ?? makeKv();
      kvBySpace.set(delegation.spaceId, kv);
      return {
        spaceId: delegation.spaceId,
        path: "",
        delegation,
        kv,
        sql: {
          db: vi.fn(() => ({
            query: vi.fn(async () => ({
              ok: true,
              data: { columns: [], rows: [], rowCount: 0 },
            })),
          })),
        },
      };
    }),
  };
  const config: EmbeddedSessionConfig = {
    win: {} as Window,
    parentOrigin: "https://tinycloud.one",
    tinycloudHost: "https://node.example",
    createTinyCloudWeb: async () => tcw as never,
    createController: (opts) => {
      options = opts;
      return controller;
    },
  };
  return {
    config,
    controller,
    tcw,
    kvBySpace,
    grant: (grant: EmbedGrant) => options!.onGrant(grant),
    revoke: () => options!.onRevoke(),
    denied: () => options!.onDenied?.(),
  };
}

