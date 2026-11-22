import { describe, expect, it, vi } from "vitest";

// TC-3870: Explorer's manifest does not ask for tinycloud.space/list, so the
// node refuses the owned-space list. Discovery must still show the spaces the
// manifest grants instead of stopping with a 401.

const address = "0x1111111111111111111111111111111111111111";
const spaceUri = (name: string) => `tinycloud:pkh:eip155:1:${address}:${name}`;

function ensureBrowserGlobals() {
  globalThis.HTMLElement ??= class HTMLElement {} as typeof HTMLElement;
  globalThis.customElements ??= {
    define() {},
    get: () => undefined,
  } as unknown as typeof customElements;
}

function makeSdk(listResult: unknown) {
  const kvBySpace = new Map<string, { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }>();
  const kvFor = (spaceId: string) => {
    let kv = kvBySpace.get(spaceId);
    if (!kv) {
      kv = {
        list: vi.fn(async (options?: { prefix?: string }) => ({
          ok: true,
          data: { keys: [`${options?.prefix ?? ""}hello.md`], truncated: false },
        })),
        get: vi.fn(async () => ({
          ok: true,
          data: { data: "hello", headers: { contentType: "text/plain", contentLength: 5 } },
        })),
      };
      kvBySpace.set(spaceId, kv);
    }
    return kv;
  };
  const sql = {
    db: vi.fn(() => ({
      query: vi.fn(async () => ({
        ok: true,
        data: { columns: ["name", "type"], rows: [], rowCount: 0 },
      })),
    })),
  };
  const tcw = {
    session: vi.fn(() => ({ address, chainId: 1, siwe: "siwe", sessionKey: "session", signature: "signature" })),
    did: "did:key:z6Mki3df9ad6e41f7aB2",
    sessionDid: "did:key:z6Mki3df9ad6e41f7aB2",
    spaceId: spaceUri("applications"),
    accountSpaceId: spaceUri("account"),
    hosts: ["https://node.tinycloud.xyz"],
    isWalletConnected: true,
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    spaces: {
      list: vi.fn(async () => listResult),
      exists: vi.fn(async () => ({ ok: true, data: true })),
      get: vi.fn((id: string) => ({ kv: kvFor(id) })),
    },
    sqlForSpace: vi.fn(() => sql),
    kvForSpace: vi.fn((id: string) => kvFor(id)),
    node: { ensurePublicSpace: vi.fn(async () => undefined), publicKV: kvFor(spaceUri("public")) },
    requestPermissions: vi.fn(),
    ensureOwnedSpaceHosted: vi.fn(async () => spaceUri("applications")),
  };
  return {
    tcw,
    connectOpenKey: vi.fn(async () => ({ address, keyId: "external-key", keyType: "EXTERNAL" as const })),
    createOpenKey: vi.fn(() => ({}) as never),
  };
}

async function connect(listResult: unknown) {
  ensureBrowserGlobals();
  const { RealExplorerDataSource } = await import("./realExplorerDataSource");
  const { tcw, connectOpenKey, createOpenKey } = makeSdk(listResult);
  const source = new RealExplorerDataSource({
    openKeyHost: "https://openkey.so",
    tinycloudHost: "https://node.tinycloud.xyz",
    createOpenKey,
    connectOpenKey,
    createTinyCloudWeb: async () => tcw as never,
  });
  return source.connect();
}

describe("owned-space list refused by the node", () => {
  it("discovers the spaces the manifest grants and notes the narrower view", async () => {
    const snapshot = await connect({
      ok: false,
      error: {
        code: "AUTH_UNAUTHORIZED",
        service: "space",
        message: "Failed to list owned spaces: HTTP 401",
        meta: { status: 401 },
      },
    });

    const byName = new Map(snapshot.spaces.map((space) => [space.name, space]));
    expect([...byName.keys()].sort()).toEqual(["account", "applications", "public", "secrets"]);
    expect(byName.get("applications")?.resources.length).toBeGreaterThan(0);
    expect(byName.get("public")?.resources.length).toBeGreaterThan(0);
    expect(byName.get("account")?.access).toBe("needs-permission");
    expect(snapshot.evidence.find((step) => step.id === "space")?.detail).toContain(
      "only spaces this sign-in can read",
    );
  });

  it("still stops discovery when the list fails for another reason", async () => {
    await expect(
      connect({
        ok: false,
        error: { code: "NETWORK_ERROR", service: "space", message: "Failed to list owned spaces: fetch failed" },
      }),
    ).rejects.toMatchObject({ kind: "network-error" });
  });
});
