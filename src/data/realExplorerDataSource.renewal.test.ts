// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admitOwnerRenewalLease } from "@tinycloud/sdk-core/delegations/renewal";
import type * as WebSdk from "@tinycloud/web-sdk";
import { loadRenewalReceipt, saveRenewalReceipt } from "../auth/renewal";
import { renewalFixture } from "../auth/renewalReceipt.fixture";

// Node environment: the SDK's CACAO decoder checks `instanceof Uint8Array`, which jsdom's realm fails.
// The renewing sign-in and the load-time restore of the standalone data source (TC-2933).

vi.mock("@tinycloud/sdk-core/delegations/renewal", () => ({
  admitOwnerRenewalLease: vi.fn(async () => undefined),
}));

const sdk = vi.hoisted(() => ({
  configs: [] as Array<Record<string, any>>,
  address: "",
  signIn: undefined as undefined | ((config: Record<string, any>) => Promise<void>),
}));

vi.mock("@tinycloud/web-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof WebSdk>();
  return {
    ...actual,
    TinyCloudWeb: vi.fn(function (this: unknown, config: Record<string, any>) {
      sdk.configs.push(config);
      return makeTcw(sdk.address, () => sdk.signIn?.(config));
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
  sdk.address = "";
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

describe("signing in through OpenKey", () => {
  it.each(["finite", "leased"] as const)("keeps a verified receipt only when the owner chooses %s access", async (choice) => {
    const { owner, record, receipt } = await renewalFixture();
    const authorizeTinyCloud = vi.fn(async () => ({
      signature: "0x",
      renewalChoice: choice,
      renewal: choice === "leased" ? receipt : undefined,
    }));
    const signMessage = vi.fn();
    sdk.address = owner.address;
    const { source } = await setup(owner.address, {
      createOpenKey: () => ({ authorizeTinyCloud, signMessage }),
      createTinyCloudWeb: undefined,
      sessionStorage: { activeAddress: () => owner.address, load: async () => record },
    });
    sdk.signIn = async (config) => {
      await config.openkey.client.authorizeTinyCloud(
        { protocolVersion: 1, siwe: "message", expiryChangeable: true },
        { mode: "iframe" },
      );
    };

    await source.connect();

    expect(authorizeTinyCloud).toHaveBeenCalledExactlyOnceWith(
      {
        protocolVersion: 1,
        siwe: "message",
        expiryChangeable: true,
        renewal: { version: 1, leaseLifetimeSeconds: 604_800 },
      },
      { mode: "iframe" },
    );
    expect(admitOwnerRenewalLease).toHaveBeenCalledTimes(choice === "leased" ? 1 : 0);
    expect(loadRenewalReceipt(owner.address)).toEqual(choice === "leased" ? receipt : null);
    await sdk.configs[0].openkey.client.signMessage("message");
    expect(signMessage).toHaveBeenCalledWith("message");
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

});

describe("disconnecting", () => {
  it("clears the saved receipt and signs out before asking OpenKey to stop a restored renewal", async () => {
    const { owner, record, receipt } = await renewalFixture();
    saveRenewalReceipt(owner.address, receipt);
    const onSignedOut = vi.fn();
    const openKeySignOut = vi.fn(async () => ({
      requestId: "r",
      revoked: true,
      savedReceipt: loadRenewalReceipt(owner.address),
    }));
    const { source, tcw } = await setup(owner.address, {
      createOpenKey: () => ({ signOut: openKeySignOut }),
      sessionStorage: {
        activeAddressForRenewal: () => owner.address,
        loadRenewalCandidate: async () => ({ status: "renewal-candidate", data: record }),
      },
    });
    expect(await source.restore()).not.toBeNull();

    await source.disconnect(onSignedOut);

    expect(tcw.signOut).toHaveBeenCalledTimes(1);
    expect(openKeySignOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledBefore(openKeySignOut);
    await expect(openKeySignOut.mock.results[0]?.value).resolves.toHaveProperty("savedReceipt", null);
  });
});

describe("a restore through the lease that fails", () => {
  const candidateStorage = (owner: string, record: unknown) => ({
    load: async () => record,
    activeAddressForRenewal: () => owner,
    loadRenewalCandidate: async () => ({ status: "renewal-candidate", data: record }),
  });

  async function failingRestore(failure: unknown, options: { lifetimeSeconds?: number } = {}) {
    const { owner, record, receipt } = await renewalFixture({
      approvedLeaseLifetimeSeconds: options.lifetimeSeconds,
    });
    saveRenewalReceipt(owner.address, receipt);
    const tcw = makeTcw(owner.address);
    tcw.restoreSessionWithRenewal.mockResolvedValueOnce(failure as never);
    const { source } = await setup(owner.address, { sessionStorage: candidateStorage(owner.address, record) }, tcw);
    return { owner, receipt, tcw, source };
  }

  it.each([
    ["a network failure", { status: "restore-failed", error: new Error("Failed to fetch") }],
    ["a timeout", { status: "restore-failed", error: Object.assign(new Error("slow"), { name: "TimeoutError" }) }],
    ["a 503", { status: "restore-failed", error: Object.assign(new Error("node"), { status: 503 }) }],
    ["a wrapped network failure", { status: "restore-failed", error: new Error("restore", { cause: new TypeError("fetch failed") }) }],
  ])("keeps the receipt and the saved record after %s, and the next load tries again", async (_name, failure) => {
    const { owner, receipt, tcw, source } = await failingRestore(failure);

    expect(await source.restore()).toBeNull();
    expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
    expect(tcw.clearPersistedSession).not.toHaveBeenCalled();

    expect(await source.restore()).not.toBeNull(); // the node answers this time
    expect(tcw.restoreSessionWithRenewal).toHaveBeenCalledTimes(2);
    expect(loadRenewalReceipt(owner.address)).toEqual(receipt);
  });

  it.each([
    ["an expired answer", { status: "expired" }],
    ["a missing record", { status: "missing" }],
    ["a stale record", { status: "stale" }],
    ["a refusal that is not a network failure", { status: "restore-failed", error: new Error("lease revoked") }],
    ["a 403", { status: "restore-failed", error: Object.assign(new Error("denied"), { status: 403 }) }],
  ])("drops the receipt and the saved record after %s", async (_name, failure) => {
    const { owner, tcw, source } = await failingRestore(failure);

    expect(await source.restore()).toBeNull();
    expect(loadRenewalReceipt(owner.address)).toBeNull();
    expect(tcw.clearPersistedSession).toHaveBeenCalledWith(owner.address);
  });

  it("drops the receipt once the lease end has passed, even though the failure was a network one", async () => {
    const { owner, tcw, source } = await failingRestore(
      { status: "restore-failed", error: new Error("Failed to fetch") },
      { lifetimeSeconds: 60 },
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 3_600_000);
      await source.restore();
    } finally {
      vi.useRealTimers();
    }

    expect(loadRenewalReceipt(owner.address)).toBeNull();
    expect(tcw.restoreSessionWithRenewal).not.toHaveBeenCalled(); // an ended lease is never presented to the node
  });
});
