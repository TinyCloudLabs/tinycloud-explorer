import { sdkMockDataSource } from "./sdkMockDataSource";
import type { AuthResult, OpenKey } from "@openkey/sdk";
import type {
  ExplorerDataSource,
  ExplorerEmbedListener,
  ExplorerSnapshot,
  ExplorerSnapshotListener,
  KvResource,
  SqlQueryResult,
  TinyCloudResource,
  TinyCloudSpace,
} from "./ExplorerDataSource";
import { readEmbedEnvironment, resolveOneParentOrigin } from "../embed/oneEmbed";

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

  private readonly listeners = new Set<ExplorerEmbedListener>();
  readonly embed?: ExplorerDataSource["embed"];

  constructor(
    private readonly config: RealExplorerDataSourceConfig,
    private readonly oneParentOrigin: string | null = null,
  ) {
    if (oneParentOrigin) {
      this.embed = {
        subscribe: (listener) => {
          this.listeners.add(listener);
          return () => {
            this.listeners.delete(listener);
          };
        },
      };
    }
  }

  // One instance, even when two callers (React StrictMode) load concurrently:
  // a second instance would be a second session key and a second hello.
  private loading: Promise<ExplorerDataSource> | null = null;

  private load(): Promise<ExplorerDataSource> {
    this.loading ??= this.create();
    return this.loading;
  }

  private async create(): Promise<ExplorerDataSource> {
    await ensureBrowserBuffer();
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const parentOrigin = this.oneParentOrigin;
    return new RealExplorerDataSource({
      ...this.config,
      embedded: parentOrigin
        ? {
            parentOrigin,
            onTheme: (theme) => this.listeners.forEach((l) => l.onTheme(theme)),
            onRevoked: () => this.listeners.forEach((l) => l.onRevoked()),
          }
        : undefined,
    });
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

function detectOneParentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return resolveOneParentOrigin(readEmbedEnvironment(window, document));
}

export function createExplorerDataSource(options?: {
  /** Tests: a validated One origin, or null to force standalone mode. */
  oneParentOrigin?: string | null;
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
  }, options?.oneParentOrigin !== undefined ? options.oneParentOrigin : detectOneParentOrigin());
}
