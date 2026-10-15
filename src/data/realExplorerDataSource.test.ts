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
  kvFailureKeys?: string[];
  kvHeaders?: (key: string) => Partial<{
    contentType: string;
    contentLength: number;
    etag: string;
    lastModified: string;
  }>;
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
      if (options?.kvFailureKeys?.includes(key)) {
        return {
          ok: false,
          error: {
            code: "NETWORK_ERROR",
            service: "kv",
            message: "network",
          },
        };
      }
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
          headers: options?.kvHeaders?.(key) ?? {
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
    spaceId: space.id,
    accountSpaceId: `tinycloud:pkh:eip155:1:${address}:account`,
    hosts: ["https://node.tinycloud.xyz"],
    isWalletConnected: true,
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    spaces: {
      list: vi.fn(async () => ({ ok: true, data: options?.spaces ?? [space] })),
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
  it("uses TinyCloud defaults and grants secrets SQL without decrypt authority", async () => {
    ensureBrowserGlobals();
    const { createExplorerManifest } = await import("./realExplorerDataSource");
    const manifest = createExplorerManifest();
    const serialized = JSON.stringify(manifest);

    expect(manifest.defaults).toBe(true);
    expect(manifest.includePublicSpace).toBe(true);
    expect(manifest.permissions).toContainEqual({
      service: "tinycloud.kv",
      space: "public",
      path: "",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
    });
    expect(manifest.permissions).toContainEqual({
      service: "tinycloud.sql",
      space: "applications",
      path: "default",
      actions: ["tinycloud.sql/read", "tinycloud.sql/schema"],
    });
    expect(manifest.permissions).toContainEqual({
      service: "tinycloud.kv",
      space: "applications",
      path: "",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/put",
        "tinycloud.kv/del",
      ],
    });
    expect(manifest.permissions).toContainEqual({
      service: "tinycloud.sql",
      space: "secrets",
      path: "default",
      actions: ["tinycloud.sql/read"],
      skipPrefix: true,
    });
    expect(manifest.permissions).toContainEqual({
      service: "tinycloud.kv",
      space: "secrets",
      path: "",
      actions: ["tinycloud.kv/list"],
      skipPrefix: true,
    });
    expect(manifest.permissions).toContainEqual({
      service: "tinycloud.kv",
      space: "secrets",
      path: "vault/secrets",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    });
    expect(manifest.permissions).toContainEqual({
      service: "tinycloud.kv",
      space: "secrets",
      path: "variables",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    });
    expect(serialized).not.toContain("tinycloud.encryption");
    expect(serialized).not.toContain("decrypt");
    expect(
      manifest.permissions?.some(
        (permission) =>
          permission.service === "tinycloud.encryption",
      ),
    ).toBe(false);
  });

  it("connects through OpenKey and discovers real spaces/resources", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, connectOpenKey, createOpenKey } = makeRealSdk({
      kvEntries: [
        ["spaces/public.json", { canary: "account-spaces" }],
        ["delegations/current.json", { canary: "account-delegations" }],
      ],
    });
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const progress: Parameters<NonNullable<Parameters<typeof source.connect>[0]>>[0][] = [];
    const snapshot = await source.connect((nextSnapshot) => {
      progress.push(nextSnapshot);
    });
    expect(connectOpenKey).toHaveBeenCalled();
    expect(tcw.signIn).toHaveBeenCalled();
    expect(progress[0]).toMatchObject({
      discovery: {
        phase: "spaces",
        completedSpaces: 0,
        totalSpaces: 4,
      },
    });
    expect(
      progress[0]?.spaces.every(
        (candidate) =>
          candidate.discoveryState === "loading" &&
          candidate.resources.length === 0,
      ),
    ).toBe(true);
    expect(
      progress.some(
        (candidate) =>
          candidate.discovery?.phase === "resources" &&
          candidate.spaces.some((space) => space.resources.length > 0),
      ),
    ).toBe(true);
    expect(progress.at(-1)?.discovery).toEqual({
      phase: "ready",
      completedSpaces: 4,
      totalSpaces: 4,
    });
    expect(
      progress.at(-1)?.spaces.every(
        (candidate) => candidate.discoveryState === "ready",
      ),
    ).toBe(true);
    expect(snapshot.spaces.map((candidate) => candidate.name)).toEqual([
      "applications",
      "secrets",
      "account",
      "public",
    ]);
    expect(tcw.ensureOwnedSpaceHosted).not.toHaveBeenCalled();
    expect(tcw.node.ensurePublicSpace).not.toHaveBeenCalled();
    const secrets = snapshot.spaces.find((candidate) => candidate.name === "secrets");
    expect(secrets).toMatchObject({
      access: "read-only",
    });
    expect(secrets?.resources.some((resource) => resource.kind === "sql")).toBe(true);
    expect(secrets?.resources.some((resource) => resource.kind === "kv")).toBe(true);
    expect(snapshot.spaces[0]?.resources.some((resource) => resource.kind === "sql")).toBe(true);
    expect(snapshot.spaces[0]?.resources.some((resource) => resource.kind === "kv")).toBe(true);
    expect(snapshot.spaces[0]?.resources.some((resource) => resource.access === "needs-permission")).toBe(true);
    expect(
      snapshot.spaces.some((space) =>
        space.resources.some(
          (resource) =>
            resource.kind === "sql" &&
            resource.tables.some((table) => table.loaded === false),
        ),
      ),
    ).toBe(true);
    const discoveredSql = snapshot.spaces.flatMap((candidate) =>
      candidate.resources.flatMap((resource) =>
        resource.kind === "sql" ? resource.tables : [],
      ),
    );
    expect(discoveredSql.filter((table) => table.loaded === false)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "events", rowCount: null }),
        expect.objectContaining({ name: "audit_log", rowCount: null }),
      ]),
    );
    expect(
      snapshot.spaces.some((space) =>
        space.resources.some(
          (resource) =>
            resource.kind === "kv" &&
            resource.entries.some((entry) =>
              JSON.stringify(entry.value ?? "").includes("account-spaces") ||
              JSON.stringify(entry.value ?? "").includes("account-delegations"),
            ),
        ),
      ),
    ).toBe(true);
  });

  it("surfaces browse-only secrets vault and variables resources without decrypt capability", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, connectOpenKey, createOpenKey } = makeRealSdk({
      permissions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.sql/read",
      ],
      kvEntries: [
        [
          "vault/secrets/EXPLORER_ALPHA_SECRET",
          {
            v: 1,
            networkId: "urn:tinycloud:encryption:did:pkh:eip155:1:0x1111111111111111111111111111111111111111:default",
            alg: "x25519-aes256gcm/v1",
            encryptedSymmetricKey: "enc-key",
            ciphertext: "ciphertext-alpha",
            keyVersion: 1,
          },
        ],
        [
          "variables/EXPLORER_FEATURE_FLAG",
          {
            value: "enabled",
            createdAt: "2026-07-28T00:00:00.000Z",
          },
        ],
      ],
      spaces: [
        {
          id: "tinycloud:pkh:eip155:1:0x1111111111111111111111111111111111111111:secrets",
          name: "secrets",
          owner: "did:pkh:eip155:1:0x1111111111111111111111111111111111111111",
          type: "owned" as const,
          permissions: ["tinycloud.kv/get", "tinycloud.kv/list", "tinycloud.sql/read"],
          status: "active" as const,
        },
      ],
    });
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      spacePrefix: "public",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    const secrets = snapshot.spaces.find((space) => space.name === "secrets");
    expect(secrets).toBeTruthy();
    const vault = secrets?.resources.find(
      (resource): resource is Extract<(typeof secrets)["resources"][number], { kind: "kv" }> =>
        resource.kind === "kv" && resource.path === "vault",
    );
    const variables = secrets?.resources.find(
      (resource): resource is Extract<(typeof secrets)["resources"][number], { kind: "kv" }> =>
        resource.kind === "kv" && resource.path === "variables",
    );
    expect(vault).toBeTruthy();
    expect(variables).toBeTruthy();
    expect(vault?.entries[0]?.value).toMatchObject({
      ciphertext: "ciphertext-alpha",
      networkId:
        "urn:tinycloud:encryption:did:pkh:eip155:1:0x1111111111111111111111111111111111111111:default",
    });
    expect(JSON.stringify(vault?.entries[0]?.value ?? "")).not.toContain("secret");
    expect(JSON.stringify(variables?.entries[0]?.value ?? "")).toContain("enabled");
  });

  it("preserves absent KV facts separately from measured zero and timestamps", async () => {
    ensureBrowserGlobals();
    // This module reads HTMLElement at load time; install browser globals first.
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, connectOpenKey, createOpenKey } = makeRealSdk({
      permissions: ["tinycloud.kv/get", "tinycloud.kv/list"],
      kvEntries: [
        ["docs/missing.md", "missing headers"],
        ["docs/measured.md", "measured"],
        ["measured/zero.md", ""],
      ],
      kvHeaders: (key) =>
        key === "docs/missing.md"
          ? {}
          : {
              contentType: "text/plain",
              contentLength: 0,
              lastModified: "2026-07-26T12:00:00Z",
            },
    });
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    const resources = snapshot.spaces[0]?.resources;
    const docs = resources?.find((resource) => resource.kind === "kv" && resource.name === "docs");
    const measured = resources?.find((resource) => resource.kind === "kv" && resource.name === "measured");
    if (!docs || docs.kind !== "kv" || !measured || measured.kind !== "kv") {
      throw new Error("Missing KV resources");
    }
    expect(docs.entries.find((entry) => entry.key === "docs/missing.md")).toMatchObject({
      contentType: "Unknown",
      size: null,
      updatedAt: null,
      encrypted: null,
    });
    expect(docs.entries.find((entry) => entry.key === "docs/measured.md")).toMatchObject({
      contentType: "text/plain",
      size: 0,
      updatedAt: "2026-07-26T12:00:00Z",
      encrypted: null,
    });
    expect(docs).toMatchObject({
      size: null,
      updatedAt: null,
      grantedBy: null,
      expiresAt: null,
    });
    expect(measured).toMatchObject({
      size: 0,
      updatedAt: "2026-07-26T12:00:00Z",
      grantedBy: null,
      expiresAt: null,
    });
  });

  it.each([
    {
      label: "partial",
      kvEntries: [
        ["docs/known.md", "known"],
        ["docs/unavailable.md", "unavailable"],
      ] as [string, unknown][],
      visibleKeys: ["docs/known.md"],
    },
    {
      label: "all-failed",
      kvEntries: [["docs/unavailable.md", "unavailable"]] as [string, unknown][],
      visibleKeys: [],
    },
  ])("marks $label listed KV retrievals incomplete without losing known entry facts", async ({
    kvEntries,
    visibleKeys,
  }) => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, connectOpenKey, createOpenKey } = makeRealSdk({
      permissions: ["tinycloud.kv/get", "tinycloud.kv/list"],
      kvEntries,
      kvFailureKeys: ["docs/unavailable.md"],
      kvHeaders: () => ({
        contentType: "text/plain",
        contentLength: 19,
        lastModified: "2026-07-26T12:00:00Z",
      }),
    });
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    const docs = snapshot.spaces[0]?.resources.find(
      (resource) => resource.kind === "kv" && resource.name === "docs",
    );
    if (!docs || docs.kind !== "kv") throw new Error("Missing listed KV resource");
    expect(docs.entries.map((entry) => entry.key)).toEqual(visibleKeys);
    if (visibleKeys.length) {
      expect(docs.entries[0]).toMatchObject({
        size: 19,
        updatedAt: "2026-07-26T12:00:00Z",
      });
    }
    expect(docs).toMatchObject({ size: null, updatedAt: null });
  }, 15_000);

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
    const listKv = kv.list;
    let attempts = 0;
    kv.list = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          error: {
            code: "NETWORK_ERROR",
            service: "kv",
            message: "network",
          },
        };
      }
      return listKv();
    }) as unknown as typeof kv.list;
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    expect(snapshot.spaces).toHaveLength(4);
    expect(snapshot.spaces[0]?.resources.some((resource) => resource.kind === "sql")).toBe(true);
    expect(kv.list).toHaveBeenCalledTimes(5);
  });

  it("includes SDK-known account, applications, and secrets when list only returns public", async () => {
    ensureBrowserGlobals();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const { tcw, connectOpenKey, createOpenKey } = makeRealSdk();
    const owner = "did:pkh:eip155:1:0x1111111111111111111111111111111111111111";
    tcw.spaces.list = vi.fn(async () => ({
      ok: true,
      data: [{
        id: "public",
        name: "public",
        owner,
        type: "owned" as const,
        permissions: ["*"],
        status: "active" as const,
      }],
    }));
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      spacePrefix: "public",
      createOpenKey,
      connectOpenKey,
      createTinyCloudWeb: async () => tcw as never,
    });

    const snapshot = await source.connect();
    expect(snapshot.spaces.map((space) => space.name).sort()).toEqual([
      "account",
      "applications",
      "public",
      "secrets",
    ]);
    expect(
      snapshot.spaces.find((space) => space.name === "account")?.access,
    ).toBe("needs-permission");
    expect(
      snapshot.spaces.find((space) => space.name === "secrets")?.resources.some(
        (resource) => resource.kind === "sql",
      ),
    ).toBe(true);
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

  it("grants read-only discovery access and uses it immediately", async () => {
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
    const account = snapshot.spaces.find((space) => space.name === "account");
    expect(account).toMatchObject({
      access: "needs-permission",
      resources: [],
    });
    if (!account) throw new Error("Missing account space");

    const granted = await source.grantSpacePermissions(account.id);
    expect(tcw.requestPermissions).toHaveBeenCalledWith([
      {
        service: "tinycloud.capabilities",
        space: account.id,
        path: "",
        actions: ["tinycloud.capabilities/read"],
      },
      {
        service: "tinycloud.kv",
        space: account.id,
        path: "",
        actions: [
          "tinycloud.kv/get",
          "tinycloud.kv/list",
          "tinycloud.kv/metadata",
        ],
      },
      {
        service: "tinycloud.sql",
        space: account.id,
        path: "account",
        actions: ["tinycloud.sql/read"],
      },
    ]);
    expect(granted.access).toBe("read-only");
    expect(granted.resources.some((resource) => resource.kind === "sql")).toBe(true);
    expect(granted.resources.some((resource) => resource.kind === "kv")).toBe(true);
    expect(tcw.sqlForSpace).toHaveBeenCalledWith(account.id);
    expect(tcw.kvForSpace).toHaveBeenCalledWith(account.id);
    expect(JSON.stringify(tcw.requestPermissions.mock.calls)).not.toMatch(
      /tinycloud\.(?:kv\/(?:put|del)|sql\/write)/,
    );
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
    // Explorer uses the capability-bearing primary session directly. It does
    // not create a second hosted-space SIWE during sign-in.
    expect(tcw.node.ensurePublicSpace).not.toHaveBeenCalled();
    expect(tcw.kvForSpace).toHaveBeenCalledWith(expectedUri);
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
