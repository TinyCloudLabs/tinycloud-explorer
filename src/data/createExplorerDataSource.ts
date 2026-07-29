import { sdkMockDataSource } from "./sdkMockDataSource";
import type { AuthResult, OpenKey } from "@openkey/sdk";
import type {
  ExplorerDataSource,
  ExplorerSnapshot,
  ExplorerSnapshotListener,
  KvResource,
  SqlQueryResult,
  TinyCloudResource,
  TinyCloudSpace,
} from "./ExplorerDataSource";

function env(name: string): string {
  return (import.meta.env[name] as string | undefined) ?? "";
}

async function ensureBrowserBuffer() {
  if (typeof globalThis.Buffer !== "undefined") return;
  const { Buffer } = await import("buffer");
  globalThis.Buffer = Buffer;
}

interface RealExplorerDataSourceConfig {
  openKeyHost: string;
  tinycloudHost: string;
  sessionStorageKeyPrefix?: string;
  spacePrefix?: string;
  kvPrefix?: string;
  connectOpenKey?: (openkey: OpenKey) => Promise<AuthResult>;
}

type DevelopmentConnectHook = (openkey: OpenKey) => Promise<AuthResult>;

async function connectOpenKey(openkey: OpenKey): Promise<AuthResult> {
  if (import.meta.env.DEV) {
    const hook = (
      globalThis as typeof globalThis & {
        __tinycloudExplorerConnectOpenKey?: DevelopmentConnectHook;
      }
    ).__tinycloudExplorerConnectOpenKey;
    if (hook) return hook(openkey);
  }
  return openkey.connect();
}

class LazyRealExplorerDataSource implements ExplorerDataSource {
  readonly mode = "real" as const;
  private inner: ExplorerDataSource | null = null;

  constructor(private readonly config: RealExplorerDataSourceConfig) {}

  private async load(): Promise<ExplorerDataSource> {
    if (!this.inner) {
      await ensureBrowserBuffer();
      const { RealExplorerDataSource } = await import("./realExplorerDataSource");
      this.inner = new RealExplorerDataSource(this.config);
    }
    return this.inner;
  }

  async connect(onSnapshot?: ExplorerSnapshotListener): Promise<ExplorerSnapshot> {
    return (await this.load()).connect(onSnapshot);
  }

  async disconnect(): Promise<void> {
    return (await this.load()).disconnect();
  }

  async listSpaces(): Promise<TinyCloudSpace[]> {
    return (await this.load()).listSpaces();
  }

  async runQuery(
    spaceId: string,
    resourceId: string,
    sql: string,
  ): Promise<SqlQueryResult> {
    return (await this.load()).runQuery(spaceId, resourceId, sql);
  }

  async writeKvEntry(
    spaceId: string,
    resourceId: string,
    key: string,
    value: unknown,
  ): Promise<KvResource> {
    return (await this.load()).writeKvEntry(spaceId, resourceId, key, value);
  }

  async deleteKvEntry(
    spaceId: string,
    resourceId: string,
    key: string,
  ): Promise<KvResource> {
    return (await this.load()).deleteKvEntry(spaceId, resourceId, key);
  }

  async grantPermission(
    spaceId: string,
    resourceId: string,
  ): Promise<TinyCloudResource> {
    return (await this.load()).grantPermission(spaceId, resourceId);
  }

  async grantSpacePermissions(spaceId: string): Promise<TinyCloudSpace> {
    return (await this.load()).grantSpacePermissions(spaceId);
  }
}

export function createExplorerDataSource(options?: {
  mode?: string;
  openKeyHost?: string;
  tinycloudHost?: string;
  sessionStorageKeyPrefix?: string;
  spacePrefix?: string;
  kvPrefix?: string;
}): ExplorerDataSource {
  const mode = (options?.mode ?? env("VITE_EXPLORER_DATA_SOURCE")).trim().toLowerCase();
  if (mode === "mock") return sdkMockDataSource;

  return new LazyRealExplorerDataSource({
    openKeyHost: options?.openKeyHost ?? (env("VITE_OPENKEY_HOST") || "https://openkey.so"),
    tinycloudHost: options?.tinycloudHost ?? (env("VITE_TINYCLOUD_HOST") || "https://node.tinycloud.xyz"),
    sessionStorageKeyPrefix:
      options?.sessionStorageKeyPrefix ??
      (env("VITE_TINYCLOUD_SESSION_PREFIX") || "tinycloud-explorer"),
    spacePrefix:
      options?.spacePrefix ?? (env("VITE_TINYCLOUD_SPACE_PREFIX") || "applications"),
    kvPrefix:
      options?.kvPrefix ??
      (env("VITE_TINYCLOUD_KV_PREFIX") || ""),
    connectOpenKey,
  });
}
