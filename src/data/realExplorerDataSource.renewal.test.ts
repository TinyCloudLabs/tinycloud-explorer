// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admitOwnerRenewalLease } from "@tinycloud/sdk-core/delegations/renewal";
import type * as WebSdk from "@tinycloud/web-sdk";
import { loadRenewalReceipt, saveRenewalReceipt } from "../auth/renewal";
import { renewalFixture } from "../auth/renewalReceipt.fixture";

// Node environment: the SDK's CACAO decoder checks `instanceof Uint8Array`, which jsdom's realm fails.
// The opt-in renewing sign-in and the load-time restore of the standalone data source (TC-2933).

vi.mock("@tinycloud/sdk-core/delegations/renewal", () => ({
  admitOwnerRenewalLease: vi.fn(async () => undefined),
}));

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
  vi.mocked(admitOwnerRenewalLease).mockClear();
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
    restoreSessionWithRenewal: vi.fn(async () => ({ status: "restored" as const })),
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

describe("signing in", () => {
  it("asks for no renewal and keeps no receipt unless the owner opts in", async () => {
    const { owner, receipt } = await renewalFixture();
    saveRenewalReceipt(owner.address, receipt); // left by an earlier sign-in
    const createTinyCloudWeb = vi.fn(async (..._args: unknown[]) => makeTcw(owner.address) as never);
    const { source } = await setup(owner.address, { createTinyCloudWeb });

    await source.connect();

    expect(createTinyCloudWeb).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), null);
    expect(admitOwnerRenewalLease).not.toHaveBeenCalled();
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  it("opted in, with no lease returned, still signs in and stays finite", async () => {
    const { owner } = await renewalFixture();
    const createTinyCloudWeb = vi.fn(async (..._args: unknown[]) => makeTcw(owner.address) as never);
    const { source } = await setup(owner.address, { createTinyCloudWeb });

    const snapshot = await source.connect(undefined, { renewal: true });

    expect(snapshot.identity).toBeDefined();
    expect(createTinyCloudWeb.mock.calls[0][3]).toEqual({ outcome: {} });
    expect(admitOwnerRenewalLease).not.toHaveBeenCalled();
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  it("refuses a lease that is not the saved session's own and still signs in finite", async () => {
    const { owner, record } = await renewalFixture();
    const { receipt: foreign } = await renewalFixture();
    const createTinyCloudWeb = vi.fn(async (_a, _b, _c, capture) => {
      capture.outcome = { renewal: foreign };
      capture.arrivedAt = performance.now();
      return makeTcw(owner.address) as never;
    });
    const { source } = await setup(owner.address, {
      createTinyCloudWeb,
      sessionStorage: { load: async () => record },
    });

    await source.connect(undefined, { renewal: true });

    expect(admitOwnerRenewalLease).not.toHaveBeenCalled();
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });

  it("keeps the receipt once the node admitted the owner's lease for the saved session", async () => {
    const { owner, record, receipt } = await renewalFixture();
    const createTinyCloudWeb = vi.fn(async (_a, _b, _c, capture) => {
      capture.outcome = { renewalChoice: "on", renewal: receipt };
      capture.arrivedAt = performance.now();
      return makeTcw(owner.address) as never;
    });
    const { source } = await setup(owner.address, {
      createTinyCloudWeb,
      sessionStorage: { load: async () => record },
    });

    await source.connect(undefined, { renewal: true });

    expect(admitOwnerRenewalLease).toHaveBeenCalledTimes(1);
    expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
  });
});

describe("the SDK configuration of a real sign-in", () => {
  const address = "0x1111111111111111111111111111111111111111";

  async function signInThroughSdk(renewal: boolean) {
    const authorizeTinyCloud = vi.fn(async () => ({ signature: "0x" }));
    const openkey = { authorizeTinyCloud } as never;
    // Dynamic: the browser globals must exist before the SDK module loads.
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey: () => openkey,
      connectOpenKey: async () => ({ address, keyId: "k", keyType: "EXTERNAL" as const }),
      sessionStorage: { load: async () => null } as never,
    });
    sdk.signIn = async (config) => {
      await config.openkey.client.authorizeTinyCloud({ siwe: "message" }, { mode: "iframe" });
    };
    await source.connect(undefined, { renewal });
    return { config: sdk.configs[0], authorizeTinyCloud, openkey };
  }

  it("is the plain OpenKey client with no ask, no changeable expiry and the SDK's own session length by default", async () => {
    const { config, authorizeTinyCloud, openkey } = await signInThroughSdk(false);
    expect(config.openkey.client).toBe(openkey);
    expect(config.openkey.mode).toBe("iframe");
    expect(config.openkey.expiryChangeable).toBeUndefined();
    expect(config.sessionExpirationMs).toBeUndefined();
    expect(authorizeTinyCloud).toHaveBeenCalledWith({ siwe: "message" }, { mode: "iframe" });
  });

  it("adds a seven-day ask, a changeable expiry capped at seven days and one-day sessions when opted in", async () => {
    const { config, authorizeTinyCloud } = await signInThroughSdk(true);
    expect(authorizeTinyCloud).toHaveBeenCalledWith(
      { siwe: "message", renewal: { version: 1, leaseLifetimeSeconds: 7 * 86_400 } },
      { mode: "iframe" },
    );
    expect(config.openkey.expiryChangeable).toBe(true);
    expect(config.openkey.maxExpiresAt()).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000);
    expect(config.sessionExpirationMs).toBe(86_400_000);
  });
});

describe("loading the page with a saved session", () => {
  it("restores through the lease, without opening OpenKey, when the saved session is past its end and has a checked receipt", async () => {
    const { owner, record, receipt, lease } = await renewalFixture();
    saveRenewalReceipt(owner.address, receipt);
    const { source, tcw, connectOpenKey } = await setup(owner.address, {
      sessionStorage: {
        load: async () => record,
        activeAddressForRenewal: () => owner.address,
        loadRenewalCandidate: async () => ({ status: "renewal-candidate", data: record }),
      },
    });

    const snapshot = await source.restore();

    expect(snapshot).not.toBeNull();
    expect(tcw.restoreSessionWithRenewal).toHaveBeenCalledWith(lease.authorization, owner.address);
    expect(tcw.restoreSession).not.toHaveBeenCalled();
    expect(connectOpenKey).not.toHaveBeenCalled();
  });

  it("restores a session still inside its signed end plainly, even when a receipt is stored", async () => {
    const { owner, record, receipt } = await renewalFixture();
    saveRenewalReceipt(owner.address, receipt);
    const { source, tcw } = await setup(owner.address, {
      sessionStorage: {
        load: async () => record,
        activeAddressForRenewal: () => owner.address,
        loadRenewalCandidate: async () => ({ status: "loaded", data: record }),
      },
    });

    expect(await source.restore()).not.toBeNull();
    expect(tcw.restoreSession).toHaveBeenCalledWith(owner.address);
    expect(tcw.restoreSessionWithRenewal).not.toHaveBeenCalled();
  });

  it("never renews a saved session that has no receipt, and leaves the connect screen to the owner", async () => {
    const { owner, record } = await renewalFixture();
    const tcw = makeTcw(owner.address);
    tcw.restoreSession.mockResolvedValue({ status: "expired" } as never);
    const { source } = await setup(
      owner.address,
      {
        sessionStorage: {
          load: async () => record,
          activeAddressForRenewal: () => owner.address,
          loadRenewalCandidate: async () => ({ status: "renewal-candidate", data: record }),
        },
      },
      tcw,
    );

    expect(await source.restore()).toBeNull();
    expect(tcw.restoreSessionWithRenewal).not.toHaveBeenCalled();
  });

  it("drops the receipt and the saved session when the node no longer renews it", async () => {
    const { owner, record, receipt } = await renewalFixture();
    saveRenewalReceipt(owner.address, receipt);
    const tcw = makeTcw(owner.address);
    tcw.restoreSessionWithRenewal.mockResolvedValue({ status: "expired" } as never);
    const { source } = await setup(
      owner.address,
      {
        sessionStorage: {
          load: async () => record,
          activeAddressForRenewal: () => owner.address,
          loadRenewalCandidate: async () => ({ status: "renewal-candidate", data: record }),
        },
      },
      tcw,
    );

    expect(await source.restore()).toBeNull();
    expect(loadRenewalReceipt(owner.address)).toBeNull();
    expect(tcw.clearPersistedSession).toHaveBeenCalledWith(owner.address);
  });

  it("does nothing when no session is saved", async () => {
    const { source, tcw, connectOpenKey } = await setup("0x1111111111111111111111111111111111111111", {
      sessionStorage: {
        load: async () => null,
        activeAddressForRenewal: () => undefined,
        loadRenewalCandidate: async () => ({ status: "missing", data: null }),
      },
    });

    expect(await source.restore()).toBeNull();
    expect(tcw.restoreSession).not.toHaveBeenCalled();
    expect(connectOpenKey).not.toHaveBeenCalled();
  });
});

describe("disconnecting", () => {
  it("signs out and clears the renewal receipt", async () => {
    const { owner, receipt } = await renewalFixture();
    const { source, tcw } = await setup(owner.address);
    await source.connect();
    saveRenewalReceipt(owner.address, receipt);

    await source.disconnect();

    expect(tcw.signOut).toHaveBeenCalled();
    expect(loadRenewalReceipt(owner.address)).toBeNull();
  });
});
