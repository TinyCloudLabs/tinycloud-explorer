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

export class SdkMockExplorerDataSource implements ExplorerDataSource {
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

  async connect(): Promise<ExplorerSnapshot> {
    const [identity, evidence, spaces] = await Promise.all([
      this.read<ExplorerIdentity>("explorer/identity"),
      this.read<typeof sdkMockSystemEvidence>("explorer/evidence"),
      this.listSpaces(),
    ]);
    return { identity, evidence, spaces };
  }

  async disconnect(): Promise<void> {
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

  async grantPermission(
    spaceId: string,
    resourceId: string,
  ): Promise<TinyCloudResource> {
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

  getSdkOperations(): RecordedOperation[] {
    return this.kv.getOperations();
  }
}

export const sdkMockDataSource = new SdkMockExplorerDataSource();
