// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as WebSdk from "@tinycloud/web-sdk";

// Node environment: the SDK's CACAO decoder checks `instanceof Uint8Array`, which jsdom's realm fails.
// The one-day sign-in, the load-time restore and the disconnect of the standalone data source.

const sdk = vi.hoisted(() => ({
  configs: [] as Array<Record<string, any>>,
  signIn: undefined as undefined | ((config: Record<string, any>) => Promise<void>),
}));

vi.mock("@tinycloud/web-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof WebSdk>();
  return {
    ...actual,
    TinyCloudWeb: vi.fn(function (this: unknown, config: Record<string, any>) {
      sdk.configs.push(config);
      return makeTcw(config.__address ?? "0x1111111111111111111111111111111111111111", () => sdk.signIn?.(config));
    }),
  };
});

function ensureBrowserGlobals() {
  globalThis.HTMLElement ??= class HTMLElement {} as typeof HTMLElement;
  globalThis.customElements ??= { define() {}, get: () => undefined } as unknown as typeof customElements;
}

const values = new Map<string, string>();

beforeEach(() => {
  ensureBrowserGlobals();
  values.clear();
  sdk.configs.length = 0;
  sdk.signIn = undefined;
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    get length() {
      return values.size;
    },
  } as Storage;
});

afterEach(() => vi.restoreAllMocks());

function makeTcw(address: string, signIn: () => unknown = async () => undefined) {
  const space = {
    id: `tinycloud:pkh:eip155:1:${address}:applications`,
    name: "applications",
    owner: `did:pkh:eip155:1:${address}`,
    type: "owned" as const,
    permissions: [] as string[],
    status: "active" as const,
  };
  const kv = {
    list: vi.fn(async () => ({ ok: true, data: { keys: [], truncated: false } })),
    get: vi.fn(async () => ({ ok: false, error: { code: "KV_NOT_FOUND", service: "kv", message: "missing" } })),
    put: vi.fn(),
    delete: vi.fn(),
  };
  const sql = {
    db: vi.fn(() => ({
      query: vi.fn(async () => ({ ok: true, data: { columns: ["name", "type"], rows: [], rowCount: 0 } })),
    })),
  };
  return {
    session: vi.fn(() => ({ address, chainId: 1, siwe: "siwe", sessionKey: "session", signature: "signature" })),
    did: "did:key:z6Mki3df9ad6e41f7aB2",
    sessionDid: "did:key:z6Mki3df9ad6e41f7aB2",
    spaceId: space.id,
    accountSpaceId: `tinycloud:pkh:eip155:1:${address}:account`,
    hosts: ["https://node.tinycloud.xyz"],
    isWalletConnected: true,
    signIn: vi.fn(signIn),
    signOut: vi.fn(async () => undefined),
    cleanup: vi.fn(),
    clearPersistedSession: vi.fn(async () => undefined),
    restoreSession: vi.fn(async () => ({ status: "restored" as const })),
    activeNodeIdentity: vi.fn(async () => ({ origin: "https://node.example", nodeDid: "did:key:z6MkNode" })),
    spaces: {
      list: vi.fn(async () => ({ ok: true, data: [space] })),
      exists: vi.fn(async () => ({ ok: true, data: true })),
      create: vi.fn(async () => ({ ok: true, data: space })),
      get: vi.fn(() => ({ kv, info: vi.fn(async () => ({ ok: true, data: space })) })),
    },
    sqlForSpace: vi.fn(() => sql),
    kvForSpace: vi.fn(() => kv),
    node: { ensurePublicSpace: vi.fn(async () => undefined), publicKV: kv },
    requestPermissions: vi.fn(),
    ensureOwnedSpaceHosted: vi.fn(async () => space.id),
  };
}

type Tcw = ReturnType<typeof makeTcw>;

async function setup(
  address: string,
  extra: Record<string, unknown> = {},
  tcw: Tcw = makeTcw(address),
) {
  // Dynamic: the browser globals must exist before the SDK module loads.
  const { RealExplorerDataSource } = await import("./realExplorerDataSource");
  const connectOpenKey = vi.fn(async () => ({ address, keyId: "external-key", keyType: "EXTERNAL" as const }));
  const source = new RealExplorerDataSource({
    openKeyHost: "https://openkey.so",
    tinycloudHost: "https://node.tinycloud.xyz",
    createOpenKey: () => ({}) as never,
    connectOpenKey,
    createTinyCloudWeb: async () => tcw as never,
    createRestoredTinyCloudWeb: () => tcw as never,
    ...extra,
  });
  return { source, tcw, connectOpenKey };
}


const address = "0x1111111111111111111111111111111111111111";

describe("the SDK configuration of a real sign-in", () => {
  it("signs in through OpenKey's frame for one day, which the owner may shorten but never lengthen", async () => {
    const authorizeTinyCloud = vi.fn(async () => ({ signature: "0x" }));
    const openkey = { authorizeTinyCloud } as never;
    // Dynamic: the browser globals must exist before the SDK module loads.
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey: () => openkey,
      connectOpenKey: async () => ({ address, keyId: "k", keyType: "EXTERNAL" as const }),
      sessionStorage: { activeAddress: () => undefined },
    });
    sdk.signIn = async (config) => {
      await config.openkey.client.authorizeTinyCloud({ siwe: "message" }, { mode: "iframe" });
    };
    await source.connect();

    const config = sdk.configs[0];
    // The request goes to OpenKey as the SDK built it: no renewal ask is added.
    expect(authorizeTinyCloud).toHaveBeenCalledWith({ siwe: "message" }, { mode: "iframe" });
    expect(config.openkey.mode).toBe("iframe");
    expect(config.openkey.expiryChangeable).toBe(true);
    expect(config.openkey.maxExpiresAt()).toBeLessThanOrEqual(Date.now() + 86_400_000);
    expect(config.sessionExpirationMs).toBe(86_400_000);
  });
});

describe("loading the page with a saved session", () => {
  it("restores a saved session without opening OpenKey", async () => {
    const { source, tcw, connectOpenKey } = await setup(address, { sessionStorage: { activeAddress: () => address } });

    expect(await source.restore()).not.toBeNull();
    expect(tcw.restoreSession).toHaveBeenCalledWith(address);
    expect(connectOpenKey).not.toHaveBeenCalled();
  });

  it("leaves the connect screen to the owner when the saved session is past its end", async () => {
    const tcw = makeTcw(address);
    tcw.restoreSession.mockResolvedValue({ status: "expired" } as never);
    const { source } = await setup(address, { sessionStorage: { activeAddress: () => address } }, tcw);

    expect(await source.restore()).toBeNull();
    expect(tcw.cleanup).toHaveBeenCalled();
  });

  it("does nothing when no session is saved", async () => {
    const { source, tcw, connectOpenKey } = await setup(address, { sessionStorage: { activeAddress: () => undefined } });

    expect(await source.restore()).toBeNull();
    expect(tcw.restoreSession).not.toHaveBeenCalled();
    expect(connectOpenKey).not.toHaveBeenCalled();
  });
});

describe("disconnecting", () => {
  it("signs the session out and says so before returning", async () => {
    const { source, tcw } = await setup(address);
    await source.connect();
    const onSignedOut = vi.fn();

    await source.disconnect(onSignedOut);

    expect(tcw.signOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("still clears the screen when the local sign-out fails, and reports the failure", async () => {
    const { source, tcw } = await setup(address);
    await source.connect();
    tcw.signOut.mockRejectedValue(new Error("node unreachable"));
    const onSignedOut = vi.fn();

    await expect(source.disconnect(onSignedOut)).rejects.toThrow("node unreachable");
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });
});
