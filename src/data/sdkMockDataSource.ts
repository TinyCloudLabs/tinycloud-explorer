import {
  createMockKV,
  createTestContext,
  type MockKVService,
  type RecordedOperation,
} from "@tinycloud/sdk-services-test";
import type {
  ExplorerDataSource,
  ExplorerIdentity,
  ExplorerSnapshot,
  ExplorerSnapshotListener,
  KvResource,
  ResourcePermissions,
  SqlQueryResult,
  SqlResource,
  TinyCloudResource,
  TinyCloudSpace,
} from "./ExplorerDataSource";
import {
  sdkMockSeed,
  sdkMockSystemEvidence,
} from "./sdkMockSeed";
import { explorerLog } from "./debugLog";

function permissionSet(
  resource: TinyCloudResource,
  access: "read-only" | "read-write",
): ResourcePermissions {
  return {
    ...resource.permissions,
    read: true,
    write: access === "read-write",
    query: resource.kind === "sql",
    grant: false,
  };
}

function concealContents(resource: TinyCloudResource): TinyCloudResource {
  if (resource.access !== "needs-permission") return structuredClone(resource);

  const concealed = {
    ...structuredClone(resource),
    size: null,
    updatedAt: null,
  };
  if (concealed.kind === "sql") {
    return {
      ...concealed,
      tables: [],
      cannedQueries: [],
    } satisfies SqlResource;
  }
  return {
    ...concealed,
    entries: [],
  } satisfies KvResource;
}

function valueSize(value: unknown): number {
  if (typeof value === "string") return value.length;
  const serialized = JSON.stringify(value);
  return serialized ? serialized.length : 0;
}

function contentTypeForValue(value: unknown): string {
  return typeof value === "string" ? "text/plain" : "application/json";
}

export class SdkMockExplorerDataSource implements ExplorerDataSource {
  readonly mode = "mock" as const;
  private readonly kv: MockKVService;

  constructor(latencyMs = 35) {
    const context = createTestContext({
      authenticated: true,
      sessionOverrides: {
        spaceId: "space:tinycloud-explorer",
        delegationCid: "d_01HZX3Q7W8Y0",
      },
    });
    this.kv = createMockKV(structuredClone(sdkMockSeed), { latencyMs });
    this.kv.initialize(context);
  }

  private async read<T>(key: string): Promise<T> {
    const result = await this.kv.get<T>(key);
    if (!result.ok) throw new Error(result.error.message);
    return structuredClone(result.data.data);
  }

  private async keys(prefix: string): Promise<string[]> {
    const result = await this.kv.list({ prefix });
    if (!result.ok) throw new Error(result.error.message);
    return result.data.keys;
  }

  private async loadResources(spaceId: string): Promise<TinyCloudResource[]> {
    const keys = await this.keys(`resources/${spaceId}`);
    const resources = await Promise.all(
      keys.map((key) => this.read<TinyCloudResource>(key)),
    );
    return resources.map(concealContents);
  }

  async connect(onSnapshot?: ExplorerSnapshotListener): Promise<ExplorerSnapshot> {
    explorerLog("info", "mock.auth", "Opening seeded SDK mock session");
    const [identity, evidence, spaces] = await Promise.all([
      this.read<ExplorerIdentity>("explorer/identity"),
      this.read<typeof sdkMockSystemEvidence>("explorer/evidence"),
      this.listSpaces(),
    ]);
    explorerLog("info", "mock.snapshot", "SDK mock snapshot ready", {
      spaces: spaces.length,
      resources: spaces.reduce((count, space) => count + space.resources.length, 0),
    });
    const snapshot: ExplorerSnapshot = {
      identity,
      evidence,
      spaces,
      discovery: {
        phase: "ready",
        completedSpaces: spaces.length,
        totalSpaces: spaces.length,
      },
    };
    onSnapshot?.(structuredClone(snapshot));
    return snapshot;
  }

  async disconnect(): Promise<void> {
    explorerLog("info", "mock.auth", "Disconnecting SDK mock session");
    this.kv.onSignOut();
  }

  async listSpaces(): Promise<TinyCloudSpace[]> {
    const order = await this.read<string[]>("explorer/space-order");
    const descriptors = await Promise.all(
      order.map((spaceId) => this.read<Omit<TinyCloudSpace, "resources">>(
        `spaces/${spaceId}`,
      )),
    );
    return Promise.all(
      descriptors.map(async (space) => ({
        ...space,
        resources: await this.loadResources(space.id),
      })),
    );
  }

  async runQuery(
    spaceId: string,
    resourceId: string,
    sql: string,
  ): Promise<SqlQueryResult> {
    explorerLog("info", "mock.sql", "Running mock SQL query", {
      space: spaceId,
      resource: resourceId,
      statement: sql.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? "",
    });
    const resource = await this.read<TinyCloudResource>(
      `resources/${spaceId}/${resourceId}`,
    );
    if (resource.kind !== "sql") {
      throw new Error("The selected resource is not queryable.");
    }
    if (!resource.permissions.query) {
      throw new Error("This delegation needs an additional query permission.");
    }
    if (!sql.trim().toLowerCase().startsWith("select")) {
      throw new Error("The SDK mock only permits SELECT statements.");
    }

    if (sql.toLowerCase().includes("count(")) {
      return {
        columns: [
          { name: "source", type: "TEXT" },
          { name: "total", type: "INTEGER" },
        ],
        rows: [
          { source: "microphone", total: 63_240 },
          { source: "upload", total: 42_907 },
          { source: "calendar", total: 22_303 },
        ],
        elapsedMs: 84,
      };
    }

    const table = resource.tables[0];
    return {
      columns: table.columns,
      rows: table.rows,
      elapsedMs: 42,
    };
  }

  async writeKvEntry(
    spaceId: string,
    resourceId: string,
    key: string,
    value: unknown,
  ): Promise<KvResource> {
    explorerLog("info", "mock.kv", "Writing mock KV entry", {
      space: spaceId,
      resource: resourceId,
      key,
    });
    const resource = await this.read<TinyCloudResource>(
      `resources/${spaceId}/${resourceId}`,
    );
    if (resource.kind !== "kv") {
      throw new Error("The selected resource is not writable.");
    }
    if (resource.access !== "read-write") {
      throw new Error("This delegation needs write permission.");
    }

    const fullKey = resource.path ? `${resource.path}/${key}` : key;
    const result = await this.kv.put(fullKey, value);
    if (!result.ok) throw new Error(result.error.message);

    const nextEntries = [
      ...resource.entries.filter((entry) => entry.key !== fullKey),
      {
        key: fullKey,
        value,
        contentType: contentTypeForValue(value),
        size: valueSize(value),
        updatedAt: new Date().toISOString(),
        cid: `mock:${encodeURIComponent(fullKey)}`,
        encrypted: null,
      },
    ];
    const updated: KvResource = {
      ...resource,
      entries: nextEntries,
      size: nextEntries.reduce((total, entry) => total + entry.size, 0),
      updatedAt: nextEntries[nextEntries.length - 1]?.updatedAt ?? resource.updatedAt,
    };
    const resourcePut = await this.kv.put(`resources/${spaceId}/${resourceId}`, updated);
    if (!resourcePut.ok) throw new Error(resourcePut.error.message);
    return updated;
  }

  async deleteKvEntry(
    spaceId: string,
    resourceId: string,
    key: string,
  ): Promise<KvResource> {
    explorerLog("info", "mock.kv", "Deleting mock KV entry", {
      space: spaceId,
      resource: resourceId,
      key,
    });
    const resource = await this.read<TinyCloudResource>(
      `resources/${spaceId}/${resourceId}`,
    );
    if (resource.kind !== "kv") {
      throw new Error("The selected resource is not deletable.");
    }

    const fullKey = resource.path ? `${resource.path}/${key}` : key;
    const result = await this.kv.delete(fullKey);
    if (!result.ok) throw new Error(result.error.message);

    const nextEntries = resource.entries.filter((entry) => entry.key !== fullKey);
    const updated: KvResource = {
      ...resource,
      entries: nextEntries,
      size: nextEntries.reduce((total, entry) => total + entry.size, 0),
      updatedAt: new Date().toISOString(),
    };
    const resourcePut = await this.kv.put(`resources/${spaceId}/${resourceId}`, updated);
    if (!resourcePut.ok) throw new Error(resourcePut.error.message);
    return updated;
  }

  async grantPermission(
    spaceId: string,
    resourceId: string,
  ): Promise<TinyCloudResource> {
    explorerLog("info", "mock.permissions", "Granting mock resource permission", {
      space: spaceId,
      resource: resourceId,
    });
    const key = `resources/${spaceId}/${resourceId}`;
    const resource = await this.read<TinyCloudResource>(key);
    if (!resource.permissions.grant) {
      throw new Error("The active identity cannot grant this permission.");
    }

    const granted: TinyCloudResource = {
      ...resource,
      access: "read-only",
      permissions: permissionSet(resource, "read-only"),
      grantedBy: "did:key:z6Mki3df9ad6e41f7aB2",
      evidence: resource.evidence.map((step) =>
        step.id === "resource"
          ? {
              ...step,
              label: "Read permission granted",
              detail: `resource: ${resource.kind}/${resource.name}`,
            }
          : step,
      ),
    };
    const result = await this.kv.put(key, granted);
    if (!result.ok) throw new Error(result.error.message);
    return concealContents(granted);
  }

  async grantSpacePermissions(spaceId: string): Promise<TinyCloudSpace> {
    explorerLog("info", "mock.permissions", "Granting mock space discovery", {
      space: spaceId,
    });
    const key = `spaces/${spaceId}`;
    const descriptor = await this.read<Omit<TinyCloudSpace, "resources">>(key);
    const granted = {
      ...descriptor,
      access:
        descriptor.access === "needs-permission"
          ? ("read-only" as const)
          : descriptor.access,
      evidence: descriptor.evidence.map((step) =>
        step.id === "space"
          ? {
              ...step,
              label: "Discovery permission granted",
              detail: `space: ${descriptor.uri}`,
            }
          : step,
      ),
    };
    const result = await this.kv.put(key, granted);
    if (!result.ok) throw new Error(result.error.message);
    const resources = await this.loadResources(spaceId);
    return {
      ...granted,
      resourceCount: resources.length,
      resources,
    };
  }

  getSdkOperations(): RecordedOperation[] {
    return this.kv.getOperations();
  }
}

export const sdkMockDataSource = new SdkMockExplorerDataSource();
