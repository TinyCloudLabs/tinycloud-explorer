import { describe, expect, it, vi } from "vitest";
import { buildSpaceUri } from "@tinycloud/sdk-core";

function ensureBrowserGlobals() {
  if (typeof globalThis.HTMLElement === "undefined") {
    globalThis.HTMLElement = class HTMLElement {} as typeof HTMLElement;
  }
  if (typeof globalThis.customElements === "undefined") {
    globalThis.customElements = {
      define() {},
      get() {
        return undefined;
      },
    } as unknown as typeof customElements;
  }
}

function makeRealSdk(options?: {
  permissions?: string[];
  kvEntries?: [string, unknown][];
  spaces?: Array<{
    id: string;
    name: string;
    owner: string;
    type: "owned" | "delegated";
    permissions: string[];
    status: "active";
  }>;
}) {
  const address = "0x1111111111111111111111111111111111111111";
  const space = {
    id: `tinycloud:pkh:eip155:1:${address}:applications`,
    name: "applications",
    owner: `did:pkh:eip155:1:${address}`,
    type: "owned" as const,
    permissions: options?.permissions ?? [],
    status: "active" as const,
  };

  const sql = {
    db: vi.fn(() => ({
      query: vi.fn(async (query: string) => {
        if (query.includes("sqlite_master")) {
          return {
            ok: true,
            data: {
              columns: ["name", "type"],
              rows: [["events", "table"], ["audit_log", "table"]],
              rowCount: 2,
            },
          };
        }
        if (query.includes("audit_log")) {
          return {
            ok: false,
            error: {
              code: "PERMISSION_DENIED",
              service: "sql",
              message: "denied",
            },
          };
        }
        if (query.toLowerCase().includes("count(*)")) {
          return {
            ok: true,
            data: {
              columns: ["total"],
              rows: [[1]],
              rowCount: 1,
            },
          };
        }
        return {
          ok: true,
          data: {
            columns: ["id", "kind"],
            rows: [["evt_1", "created"]],
            rowCount: 1,
          },
        };
      }),
    })),
  };

  const kvStore = new Map<string, unknown>(
    options?.kvEntries ?? [
      ["docs/hello.md", "hello"],
      ["docs/private.md", "secret"],
    ],
  );

  const kv = {
    list: vi.fn(async () => ({
      ok: true,
      data: {
        keys: [...kvStore.keys()],
        truncated: false,
      },
    })),
    get: vi.fn(async (key: string) => {
      if (key === "docs/private.md") {
        return {
          ok: false,
          error: {
            code: "PERMISSION_DENIED",
            service: "kv",
            message: "denied",
          },
        };
      }
      if (!kvStore.has(key)) {
        return {
          ok: false,
          error: {
            code: "KV_NOT_FOUND",
            service: "kv",
            message: "missing",
          },
        };
      }
      return {
        ok: true,
        data: {
          data: kvStore.get(key),
          headers: {
            contentType: "text/plain",
            contentLength: String(kvStore.get(key) ?? "").length,
            etag: '"blake3-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
            lastModified: "2026-07-26T12:00:00Z",
          },
        },
      };
    }),
    put: vi.fn(async () => ({
      ok: true,
      data: {
        data: undefined,
        headers: {
          contentType: "text/plain",
          contentLength: 5,
        },
      },
    })),
    delete: vi.fn(async (key: string) => {
      kvStore.delete(key);
      return {
        ok: true,
        data: {
          data: undefined,
          headers: {
            contentType: "text/plain",
            contentLength: 5,
          },
        },
      };
    }),
  };

  const originalPut = kv.put;
  kv.put = vi.fn(async (key: string, value: unknown) => {
    kvStore.set(key, value);
    return {
      ok: true,
      data: {
        data: undefined,
        headers: {
          contentType: "text/plain",
          contentLength: 5,
        },
      },
    };
  }) as typeof originalPut;

  const tcw = {
    session: vi.fn(() => ({
      address,
      chainId: 1,
      siwe: "siwe",
      sessionKey: "session",
      signature: "signature",
    })),
    did: "did:key:z6Mki3df9ad6e41f7aB2",
    sessionDid: "did:key:z6Mki3df9ad6e41f7aB2",
    hosts: ["https://node.tinycloud.xyz"],
    isWalletConnected: true,
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    spaces: {
      list: vi.fn(async () => ({ ok: true, data: [space] })),
      exists: vi.fn(async () => ({ ok: true, data: true })),
      create: vi.fn(async () => ({ ok: true, data: space })),
      get: vi.fn(() => ({
        kv,
        info: vi.fn(async () => ({ ok: true, data: space })),
      })),
    },
    sqlForSpace: vi.fn(() => sql),
    kvForSpace: vi.fn(() => kv),
    node: {
      ensurePublicSpace: vi.fn(async () => undefined),
      publicKV: kv,
    },
    requestPermissions: vi.fn(async () => ({
      approved: true,
      delegations: [{ cid: "runtime" }],
      session: { sessionKey: "session" },
    })),
    ensureOwnedSpaceHosted: vi.fn(async () => space.id),
  };

  const connectOpenKey = vi.fn(async () => ({
    address,
    keyId: "external-key",
    keyType: "EXTERNAL" as const,
  }));
  const createOpenKey = vi.fn(() => ({} as never));

  return { tcw, space, sql, kv, connectOpenKey, createOpenKey };
}

describe("RealExplorerDataSource", () => {
  it("connects through OpenKey and discovers real spaces/resources", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, connectOpenKey, createOpenKey } = makeRealSdk();
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    expect(connectOpenKey).toHaveBeenCalled();
    expect(tcw.signIn).toHaveBeenCalled();
    expect(snapshot.spaces).toHaveLength(1);
    expect(snapshot.spaces[0]?.resources.some((resource) => resource.kind === "sql")).toBe(true);
    expect(snapshot.spaces[0]?.resources.some((resource) => resource.kind === "kv")).toBe(true);
    expect(snapshot.spaces[0]?.resources.some((resource) => resource.access === "needs-permission")).toBe(true);
    expect(
      snapshot.spaces[0]?.resources.find((resource) => resource.kind === "sql")?.tables.some((table) => table.concealed),
    ).toBe(true);
    expect(
      snapshot.spaces[0]?.resources.find((resource) => resource.kind === "kv")?.entries.some((entry) => entry.hidden),
    ).toBe(true);
  });

  it("writes and deletes KV entries through the real SDK surface", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, space, kv, connectOpenKey, createOpenKey } = makeRealSdk({
      permissions: ["tinycloud.kv/get", "tinycloud.kv/list", "tinycloud.kv/put", "tinycloud.sql/read"],
    });
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    const kvResource = snapshot.spaces[0]?.resources.find((resource) => resource.kind === "kv");
    expect(kvResource?.access).toBe("read-write");
    expect(kvResource?.kind).toBe("kv");
    if (!kvResource || kvResource.kind !== "kv") throw new Error("Missing KV resource");

    const written = await source.writeKvEntry(space.id, kvResource.id, "e2e/generated.json", {
      message: "hello",
    });
    expect(kv.put).toHaveBeenCalledWith(
      "docs/e2e/generated.json",
      { message: "hello" },
    );
    expect(written.entries.some((entry) => entry.key.includes("e2e/generated.json"))).toBe(true);

    const deleted = await source.deleteKvEntry(space.id, kvResource.id, "e2e/generated.json");
    expect(kv.delete).toHaveBeenCalledWith("docs/e2e/generated.json");
    expect(deleted.entries.some((entry) => entry.key.includes("e2e/generated.json"))).toBe(false);
  });

  it("keeps cleanup stable when deleting the last visible KV record", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, space, kv, connectOpenKey, createOpenKey } = makeRealSdk({
      permissions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/put",
        "tinycloud.sql/read",
      ],
      kvEntries: [["docs/generated.json", { message: "hello" }]],
    });
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    const kvResource = snapshot.spaces[0]?.resources.find((resource) => resource.kind === "kv");
    expect(kvResource?.entries).toHaveLength(1);
    if (!kvResource || kvResource.kind !== "kv") throw new Error("Missing KV resource");

    const deleted = await source.deleteKvEntry(space.id, kvResource.id, "generated.json");
    expect(kv.delete).toHaveBeenCalledWith("docs/generated.json");
    expect(deleted.entries).toHaveLength(0);
    expect(deleted.name).toBe("docs");
  });

  it("keeps discovery alive when one resource path hits a transient network error", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, connectOpenKey, createOpenKey, kv } = makeRealSdk({
      permissions: ["tinycloud.kv/list", "tinycloud.sql/read"],
    });
    kv.list = vi.fn(async () => ({
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        service: "kv",
        message: "network",
      },
    })) as unknown as typeof kv.list;
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    expect(snapshot.spaces).toHaveLength(1);
    expect(snapshot.spaces[0]?.resources.some((resource) => resource.kind === "sql")).toBe(true);
  });

  it("models a known SQL database as needing permission when catalog access is denied", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, connectOpenKey, createOpenKey } = makeRealSdk();
    tcw.sqlForSpace = vi.fn(() => ({
      db: vi.fn(() => ({
        query: vi.fn(async () => ({
          ok: false,
          error: {
            code: "PERMISSION_DENIED",
            service: "sql",
            message: "Unauthorized Action",
          },
        })),
      })),
    })) as unknown as typeof tcw.sqlForSpace;
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    const sqlResource = snapshot.spaces[0]?.resources.find(
      (resource) => resource.kind === "sql",
    );
    expect(sqlResource).toMatchObject({
      name: "default",
      access: "needs-permission",
      permissions: {
        read: false,
        query: false,
        grant: true,
      },
    });
  });

  it("requests real capability approval instead of simulating a grant", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, space, connectOpenKey, createOpenKey } = makeRealSdk();
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    const resource = snapshot.spaces[0]?.resources.find((candidate) => candidate.kind === "kv");
    if (!resource || resource.kind !== "kv") throw new Error("Missing KV resource");

    await source.grantPermission(space.id, resource.id);
    expect(tcw.requestPermissions).toHaveBeenCalled();
  });

  it("requests space-root write access before the empty-space writer can run", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, space, connectOpenKey, createOpenKey } = makeRealSdk();
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      kvPrefix: "tinycloud-explorer-e2e/",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    await source.connect();
    await source.grantPermission(space.id, "__space__");
    expect(tcw.requestPermissions).toHaveBeenCalledWith([
      expect.objectContaining({
        service: "tinycloud.kv",
        space: space.id,
        path: "tinycloud-explorer-e2e/",
        actions: [
          "tinycloud.kv/get",
          "tinycloud.kv/list",
          "tinycloud.kv/put",
        ],
      }),
    ]);
  });

  it("prefers the configured app space ahead of public discovery", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, connectOpenKey, createOpenKey } = makeRealSdk();
    const publicSpace = {
      id: "tinycloud:pkh:eip155:1:0x1111111111111111111111111111111111111111:public",
      name: "public",
      owner: "did:pkh:eip155:1:0x1111111111111111111111111111111111111111",
      type: "owned" as const,
      permissions: [],
      status: "active" as const,
    };
    const explorerSpace = {
      id: "tinycloud:pkh:eip155:1:0x1111111111111111111111111111111111111111:explorer",
      name: "explorer",
      owner: "did:pkh:eip155:1:0x1111111111111111111111111111111111111111",
      type: "owned" as const,
      permissions: ["*"],
      status: "active" as const,
    };
    tcw.spaces.list = vi.fn(async () => ({ ok: true, data: [publicSpace, explorerSpace] }));
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      spacePrefix: "explorer",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    expect(snapshot.spaces[0]?.name).toBe("explorer");
    expect(snapshot.spaces.some((space) => space.name === "public")).toBe(true);
  });

  it("normalizes a listed short-id owned public space to a full URI for KV routing", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, connectOpenKey, createOpenKey } = makeRealSdk({
      permissions: ["tinycloud.kv/list"],
    });
    const owner = "did:pkh:eip155:1:0x1111111111111111111111111111111111111111";
    const shortPublicSpace = {
      id: "public",
      name: "public",
      owner,
      type: "owned" as const,
      permissions: ["tinycloud.kv/list"],
      status: "active" as const,
    };
    tcw.spaces.list = vi.fn(async () => ({ ok: true, data: [shortPublicSpace] }));

    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      spacePrefix: "public",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    const expectedUri = buildSpaceUri(owner, "public");
    expect(expectedUri).toBe(
      "tinycloud:pkh:eip155:1:0x1111111111111111111111111111111111111111:public",
    );
    expect(snapshot.spaces[0]?.id).toBe(expectedUri);
    expect(snapshot.spaces[0]?.uri).toBe(expectedUri);
    // Short name is preserved only for display.
    expect(snapshot.spaces[0]?.name).toBe("public");
    // The SDK creates a separately delegated KV service for public-space
    // operations. The primary sign-in session cannot authorize these writes.
    expect(tcw.node.ensurePublicSpace).toHaveBeenCalled();
    expect(tcw.node.publicKV.list).toHaveBeenCalled();
    expect(tcw.kvForSpace).not.toHaveBeenCalledWith(expectedUri);
    expect(tcw.kvForSpace).not.toHaveBeenCalledWith("public");
  });

  it("deletes a full workspace key without double-prefixing the resource path", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, space, kv, connectOpenKey, createOpenKey } = makeRealSdk({
      permissions: ["tinycloud.kv/get", "tinycloud.kv/list", "tinycloud.kv/put"],
      kvEntries: [["e2e-run42/generated.json", { message: "hello" }]],
    });
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    const kvResource = snapshot.spaces[0]?.resources.find(
      (resource) => resource.kind === "kv",
    );
    if (!kvResource || kvResource.kind !== "kv") throw new Error("Missing KV resource");
    expect(kvResource.path).toBe("e2e-run42");

    // The workspace deletes by the entry's full key, which already carries the
    // resource prefix; the prefix must not be applied twice.
    const deleted = await source.deleteKvEntry(
      space.id,
      kvResource.id,
      "e2e-run42/generated.json",
    );
    expect(kv.delete).toHaveBeenCalledWith("e2e-run42/generated.json");
    expect(kv.delete).not.toHaveBeenCalledWith(
      "e2e-run42/e2e-run42/generated.json",
    );
    expect(deleted.entries).toHaveLength(0);
  });
});
