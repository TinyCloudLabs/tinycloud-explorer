import { OpenKey, OpenKeyProvider, type AuthResult } from "@openkey/sdk";
import { providers } from "ethers";
import {
  BrowserSessionStorage,
  TinyCloudWeb,
  type Config as TinyCloudWebConfig,
  type Manifest,
  type PermissionEntry,
} from "@tinycloud/web-sdk";
import { buildSpaceUri } from "@tinycloud/sdk-core";
import type { SpaceInfo } from "@tinycloud/sdk-core";
import {
  EXPLORER_RENEWAL_ASK,
  RENEWAL_LEASE_SECONDS,
  RENEWING_SESSION_MS,
  admitSignInRenewal,
  clearRenewalReceipt,
  openKeyRenewalClient,
  readOnlyAccountProvider,
  renewalRestoreFor,
  type RenewalCapture,
} from "../auth/renewal";
import {
  REAL_FIXTURE_PUBLIC_SPACE,
  REAL_FIXTURE_SECRETS_SPACE,
} from "./realFixture";

import type {
  AccessMode,
  CapabilityStep,
  ConnectOptions,
  ExplorerDataSource,
  ExplorerIdentity,
  ExplorerSnapshot,
  ExplorerSnapshotListener,
  KvEntry,
  KvResource,
  ResourcePermissions,
  SqlCell,
  SqlColumn,
  SqlQueryResult,
  SqlResource,
  SqlTable,
  TinyCloudResource,
  TinyCloudSpace,
} from "./ExplorerDataSource";
import {
  classifyExplorerFailure,
  explorerError,
} from "./explorerErrors";
import {
  explorerLog,
  installExplorerHttpLogging,
  startExplorerOperation,
} from "./debugLog";
import {
  EXPLORER_EMBEDDED_SPACES,
  embeddedPermissionsFor,
  OneEmbedSession,
  absoluteKv,
  type EmbeddedSessionConfig,
} from "../embed/embeddedSession";

type SpaceKv = Pick<ReturnType<TinyCloudWeb["kvForSpace"]>, "list" | "get" | "put" | "delete">;
type SqlHandle = ReturnType<ReturnType<TinyCloudWeb["sqlForSpace"]>["db"]>;

type RestorableSessionStorage = Pick<
  BrowserSessionStorage,
  "load" | "activeAddressForRenewal" | "loadRenewalCandidate"
>;

interface RealExplorerDataSourceConfig {
  openKeyHost: string;
  tinycloudHost: string;
  sessionStorageKeyPrefix?: string;
  spacePrefix?: string;
  kvPrefix?: string;
  appName?: string;
  createOpenKey?: () => OpenKey;
  connectOpenKey?: (openkey: OpenKey) => Promise<AuthResult>;
  createTinyCloudWeb?: (
    auth: AuthResult,
    openkey: OpenKey,
    web3Provider: providers.Web3Provider,
    /** Set for an opted-in renewing sign-in; the real path fills it from OpenKey's result. */
    renewal: RenewalCapture | null,
  ) => Promise<TinyCloudWeb> | TinyCloudWeb;
  /** Test seams for the standalone restore. */
  sessionStorage?: RestorableSessionStorage;
  createRestoredTinyCloudWeb?: (address: string) => TinyCloudWeb;
  /** Set when Explorer is framed by TinyCloud One: no wallet sign-in, One delegates per space. */
  embedded?: {
    parentOrigin: string;
    onTheme?: (theme: "light" | "dark") => void;
    onRevoked?: () => void;
    /** Test seam. */
    createSession?: (config: EmbeddedSessionConfig) => OneEmbedSession;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function failureDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      ...(record.code ? { code: record.code } : {}),
      ...(record.service ? { service: record.service } : {}),
      ...(record.message ? { message: record.message } : {}),
    };
  }
  return { message: String(error) };
}

async function retryTransientFailure<T extends {
  ok: boolean;
  error?: { code?: string; message?: string };
}>(operation: () => Promise<T>): Promise<T> {
  let result = await operation();
  for (const delayMs of [1_000, 2_000, 4_000]) {
    if (result.ok) return result;
    const message = result.error?.message?.toLowerCase() ?? "";
    const retryable =
      result.error?.code === "NETWORK_ERROR" ||
      message.includes("not yet valid") ||
      message.includes("connection pool timed out") ||
      message.includes("invocation replay storage unavailable");
    if (!retryable) return result;
    explorerLog("warn", "invocation", "TinyCloud request delayed; retrying", {
      delayMs,
      code: result.error?.code,
      message: result.error?.message,
    });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    result = await operation();
  }
  return result;
}

function formatCount(count: number): string {
  return new Intl.NumberFormat().format(count);
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function resourcePermissions(access: AccessMode, kind: "sql" | "kv"): ResourcePermissions {
  return {
    list: true,
    describe: true,
    read: access !== "needs-permission",
    write: access === "read-write",
    query: kind === "sql" && access !== "needs-permission",
    grant: access === "needs-permission",
  };
}

function recordRow(columns: readonly string[], row: readonly unknown[]): Record<string, SqlCell> {
  return Object.fromEntries(
    columns.map((column, index) => [column, (row[index] ?? null) as SqlCell]),
  );
}

function mapQueryResult(result: { columns: readonly string[]; rows: readonly (readonly unknown[])[]; rowCount: number }): SqlQueryResult {
  return {
    columns: result.columns.map((name) => ({ name, type: "TEXT" })),
    rows: result.rows.map((row) => recordRow(result.columns, row)),
    elapsedMs: 0,
  };
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function topLevelPrefix(key: string): string {
  const [prefix] = key.split("/", 1);
  return prefix || key;
}

function kvResourceId(spaceId: string, prefix: string): string {
  return `${spaceId}::kv::${encodeURIComponent(prefix)}`;
}

function emptyKvResource(
  spaceId: string,
  space: TinyCloudSpace,
  prefix: string,
): KvResource {
  const access: AccessMode = space.access === "read-write" ? "read-write" : "read-only";
  return {
    id: kvResourceId(spaceId, prefix),
    name: prefix,
    path: prefix,
    kind: "kv",
    access,
    owner: space.owner,
    grantedBy: null,
    expiresAt: null,
    size: 0,
    updatedAt: null,
    permissions: resourcePermissions(access, "kv"),
    evidence: [
      {
        id: "session",
        label: "Session established",
        detail: `address: ${shortAddress(space.owner)}`,
        timestamp: nowIso(),
        verified: true,
      },
      {
        id: "resource",
        label: "KV keys discovered",
        detail: "0 keys visible",
        timestamp: nowIso(),
        verified: true,
      },
    ],
    entries: [],
  };
}

function sqlResourceId(spaceId: string, database: string): string {
  return `${spaceId}::sql::${encodeURIComponent(database)}`;
}

function sqlDatabaseForSpace(space: Pick<TinyCloudSpace, "id" | "name">): string {
  return space.name === "account" || space.id.endsWith(":account")
    ? "account"
    : "default";
}

function secretsSqlResource(
  space: TinyCloudSpace,
  sessionAddress: string,
): SqlResource {
  return {
    id: sqlResourceId(space.id, "default"),
    name: "default",
    path: "default",
    kind: "sql",
    access: "read-only",
    owner: space.owner,
    grantedBy: null,
    expiresAt: null,
    size: null,
    updatedAt: null,
    permissions: resourcePermissions("read-only", "sql"),
    evidence: [
      {
        id: "session",
        label: "Session established",
        detail: `address: ${shortAddress(sessionAddress)}`,
        timestamp: nowIso(),
        verified: true,
      },
      {
        id: "resource",
        label: "Secret metadata only",
        detail: "SQL read is requested; secret-value decryption is not.",
        timestamp: nowIso(),
        verified: true,
      },
    ],
    tables: [],
    cannedQueries: [],
  };
}

function discoverableSpaceAccess(space: SpaceInfo): AccessMode {
  const permissions = new Set(space.permissions ?? []);
  if (
    permissions.has("*") ||
    [...permissions].some((permission) => permission.endsWith("/*")) ||
    permissions.has("tinycloud.kv/put") ||
    permissions.has("tinycloud.sql/write")
  ) {
    return "read-write";
  }
  if (permissions.size > 0) return "read-only";
  return "needs-permission";
}

// `spaces.list()` can expose an owned space with a short id such as "public".
// `kvForSpace`/`sqlForSpace` require the full `tinycloud:pkh:...` URI, so
// normalize every listed space to its canonical URI before it becomes an
// Explorer space id. Already-canonical ids are returned untouched.
function canonicalSpaceUri(space: SpaceInfo): string {
  if (space.id.startsWith("tinycloud:")) return space.id;
  return buildSpaceUri(space.owner, space.name ?? space.id);
}

export function createExplorerManifest(space = "applications"): Manifest {
  const permissions: PermissionEntry[] = [
    {
      service: "tinycloud.kv",
      space: REAL_FIXTURE_PUBLIC_SPACE,
      path: "",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
    },
    {
      service: "tinycloud.sql",
      space: REAL_FIXTURE_SECRETS_SPACE,
      path: "default",
      actions: ["tinycloud.sql/read"],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: REAL_FIXTURE_SECRETS_SPACE,
      path: "",
      actions: ["tinycloud.kv/list"],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: REAL_FIXTURE_SECRETS_SPACE,
      path: "vault/secrets",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: REAL_FIXTURE_SECRETS_SPACE,
      path: "variables",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
  ];

  if (space !== "public" && space !== "secrets") {
    permissions.unshift(
      {
        service: "tinycloud.kv",
        space,
        path: "",
        actions: [
          "tinycloud.kv/get",
          "tinycloud.kv/list",
          "tinycloud.kv/put",
          "tinycloud.kv/del",
        ],
      },
      {
        service: "tinycloud.sql",
        space,
        path: "default",
        actions: ["tinycloud.sql/read", "tinycloud.sql/schema"],
      },
    );
  }

  return {
    app_id: "xyz.tinycloud.explorer",
    name: "TinyCloud Explorer",
    description: "Spatial browser for TinyCloud spaces, SQL tables, and KV data.",
    appVersion: "0.1.0",
    space: "applications",
    defaults: true,
    includePublicSpace: true,
    prefix: "",
    permissions,
  };
}

export class RealExplorerDataSource implements ExplorerDataSource {
  readonly mode = "real" as const;

  private tcw: TinyCloudWeb | null = null;
  private browserSessionStorage: BrowserSessionStorage | null = null;
  private restoring: Promise<ExplorerSnapshot | null> | null = null;
  private snapshot: ExplorerSnapshot | null = null;
  private readonly resourcesBySpace = new Map<string, TinyCloudResource[]>();
  private readonly approvedSpaceIds = new Set<string>();
  private embedded: OneEmbedSession | null = null;
  private embeddedConnect: Promise<ExplorerSnapshot> | null = null;

  constructor(private readonly config: RealExplorerDataSourceConfig) {}

  private makeOpenKey(): OpenKey {
    return this.config.createOpenKey?.() ?? new OpenKey({
      host: this.config.openKeyHost,
      appName: this.config.appName ?? "TinyCloud Explorer",
    });
  }

  private baseTinyCloudConfig(): TinyCloudWebConfig {
    return {
      tinycloudHosts: [this.config.tinycloudHost],
      // 3.x names the old "no fallback host" setting newUserHost: null.
      newUserHost: null,
      tinycloudRegistryUrl: null,
      autoDiscoverLocalNode: false,
      // Exploration must not host or create spaces during sign-in. The signed
      // manifest is the single source of session authority; mutations can
      // explicitly provision a missing space later.
      autoCreateSpace: false,
      kvPrefix: this.config.kvPrefix ?? "",
      spacePrefix: this.config.spacePrefix ?? "applications",
      sessionStorageKeyPrefix: this.sessionStorageKeyPrefix(),
      persistSession: true,
      manifest: createExplorerManifest(this.config.spacePrefix ?? "applications"),
    };
  }

  private sessionStorageKeyPrefix(): string {
    return this.config.sessionStorageKeyPrefix ?? "tinycloud-explorer";
  }

  /** The same browser storage the SDK's own persisted session uses. */
  private sessionStorage(): RestorableSessionStorage {
    return (
      this.config.sessionStorage ??
      (this.browserSessionStorage ??= new BrowserSessionStorage({
        keyPrefix: this.sessionStorageKeyPrefix(),
      }))
    );
  }

  /** A client with no wallet to sign with: its `session()` answers from the saved address. */
  private makeRestoredTinyCloudWeb(address: string): TinyCloudWeb {
    const make = this.config.createRestoredTinyCloudWeb;
    if (make) return make(address);
    return new TinyCloudWeb({
      ...this.baseTinyCloudConfig(),
      provider: readOnlyAccountProvider(address),
      // Later grants the owner approves still sign through OpenKey.
      openkey: { client: this.makeOpenKey(), mode: "iframe" },
    });
  }

  private async makeTinyCloudWeb(
    openkey: OpenKey,
    auth: AuthResult,
    capture: RenewalCapture | null,
  ): Promise<TinyCloudWeb> {
    const openKeyProvider = new OpenKeyProvider(openkey, auth);
    const web3Provider = new providers.Web3Provider(
      openKeyProvider as unknown as providers.ExternalProvider,
    );
    const create = this.config.createTinyCloudWeb;
    if (create) return create(auth, openkey, web3Provider, capture);

    // The SDK wants an EIP-1193 provider with event methods; OpenKey has no events to forward.
    const wallet = {
      request: (args: { method: string; params?: unknown[] }) => openKeyProvider.request(args),
      on: () => undefined,
      removeListener: () => undefined,
    };
    return new TinyCloudWeb({
      ...this.baseTinyCloudConfig(),
      providers: {
        web3: {
          driver: wallet,
        },
      },
      provider: wallet,
      // Sign in through OpenKey's versioned authorizeTinyCloud, in its own frame. Only an opted-in sign-in adds the
      // renewal ask, lets the owner shorten the expiry, and signs one day at a time for the lease to renew.
      ...(capture
        ? {
            openkey: {
              client: openKeyRenewalClient(openkey, EXPLORER_RENEWAL_ASK, capture),
              mode: "iframe" as const,
              expiryChangeable: true,
              maxExpiresAt: () => Date.now() + RENEWAL_LEASE_SECONDS * 1000,
            },
            sessionExpirationMs: RENEWING_SESSION_MS,
          }
        : { openkey: { client: openkey, mode: "iframe" as const } }),
    });
  }

  private preferredSpaceName(): string | null {
    return (this.config.spacePrefix ?? "applications").trim() || null;
  }

  private materializeSpace(space: SpaceInfo, sessionAddress: string): TinyCloudSpace {
    const uri = canonicalSpaceUri(space);
    const configuredSpace = this.config.spacePrefix?.trim();
    const access =
      !this.embedded &&
      configuredSpace &&
        (space.name === configuredSpace ||
          space.id === configuredSpace ||
          uri.endsWith(`:${configuredSpace}`))
        ? "read-write"
        : discoverableSpaceAccess(space);
    return {
      id: uri,
      name: space.name ?? space.id,
      uri,
      owner: space.owner,
      resourceCount: 0,
      access,
      discoveryState: "loading",
      resources: [],
      evidence: [
        {
          id: "session",
          label: "Session established",
          detail: shortAddress(sessionAddress),
          timestamp: nowIso(),
          verified: true,
        },
        {
          id: "space",
          label: "Space visible",
          detail: space.type === "owned" ? "owned space" : "delegated space",
          timestamp: nowIso(),
          verified: true,
        },
      ],
    };
  }

  private sessionOf(tcw: TinyCloudWeb): { address: string; chainId: number } | null {
    if (this.embedded) return this.embedded.owner;
    return tcw.session() ?? null;
  }

  private kvServiceForSpace(tcw: TinyCloudWeb, spaceId: string): SpaceKv {
    if (!this.embedded) return tcw.kvForSpace(spaceId);
    const access = this.embedded.accessFor(spaceId);
    if (!access) {
      throw explorerError("denied-capability", "Additional permission required.");
    }
    return absoluteKv(access.kv) as unknown as SpaceKv;
  }

  private sqlDatabase(tcw: TinyCloudWeb, spaceId: string, database: string): SqlHandle {
    if (!this.embedded) return tcw.sqlForSpace(spaceId).db(database);
    const access = this.embedded.accessFor(spaceId);
    if (!access) {
      throw explorerError("denied-capability", "Additional permission required.");
    }
    return access.sql.db(database) as unknown as SqlHandle;
  }

  private async requestPermissions(
    tcw: TinyCloudWeb,
    permissions: PermissionEntry[],
  ): Promise<{ approved: boolean; delegations?: readonly unknown[] }> {
    if (!this.embedded) return tcw.requestPermissions(permissions);
    const result = await this.embedded.request(permissions);
    if (result.kind === "revoked") {
      throw explorerError("expired-session", "TinyCloud session expired. Sign in again.");
    }
    return { approved: result.kind === "grant" };
  }

  private compareSpaces(a: TinyCloudSpace, b: TinyCloudSpace): number {
    const preferred = this.preferredSpaceName();
    if (preferred) {
      const aPreferred = a.name === preferred || a.id.endsWith(`:${preferred}`);
      const bPreferred = b.name === preferred || b.id.endsWith(`:${preferred}`);
      if (aPreferred !== bPreferred) {
        return aPreferred ? -1 : 1;
      }
    }

    const accessRank: Record<AccessMode, number> = {
      "read-write": 0,
      "read-only": 1,
      "needs-permission": 2,
    };
    const accessDiff = accessRank[a.access] - accessRank[b.access];
    if (accessDiff !== 0) return accessDiff;
    return a.name.localeCompare(b.name);
  }

  private knownOwnedSpaces(tcw: TinyCloudWeb): SpaceInfo[] {
    const session = this.sessionOf(tcw);
    if (!session) return [];

    const owner = `did:pkh:eip155:${session.chainId}:${session.address}`;
    const spaces = new Map<string, SpaceInfo>();
    const add = (id: string | undefined, name: string, permissions: string[] = []) => {
      if (!id) return;
      spaces.set(id, {
        id,
        name,
        owner,
        type: "owned",
        permissions,
      });
    };

    if (this.embedded) {
      // Session-only: no account space and no listing. A granted space carries
      // the actions One delegated; the others ask One via tc-embed/request.
      for (const name of EXPLORER_EMBEDDED_SPACES) {
        const id = buildSpaceUri(owner, name);
        add(id, name, this.embedded.actionsFor(id));
      }
      return [...spaces.values()];
    }

    add(tcw.accountSpaceId, "account");
    if (tcw.spaceId) {
      add(tcw.spaceId, tcw.spaceId.split(":").at(-1) ?? "applications");
    }
    add(buildSpaceUri(owner, "applications"), "applications");
    add(buildSpaceUri(owner, "public"), "public");
    add(buildSpaceUri(owner, "secrets"), "secrets");

    return [...spaces.values()];
  }

  private async ensureTinyCloud(): Promise<TinyCloudWeb> {
    if (!this.tcw) {
      throw explorerError("expired-session", "Connect TinyCloud before using the Explorer.");
    }
    return this.tcw;
  }

  private async discoverSqlResource(
    tcw: TinyCloudWeb,
    space: TinyCloudSpace,
    access: AccessMode,
  ): Promise<SqlResource | null> {
    const database = sqlDatabaseForSpace(space);
    explorerLog("debug", "sql.discovery", "Reading SQL catalog", {
      space: space.id,
      database,
    });
    const sql = this.sqlDatabase(tcw, space.id, database);
    const schemaResult = await retryTransientFailure(() =>
      sql.query<{ name: string; type: string }>(
        `SELECT name, type
         FROM sqlite_master
         WHERE type IN ('table', 'view')
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      ),
    );

    if (!schemaResult.ok) {
      const failure = classifyExplorerFailure(schemaResult.error);
      if (failure === "cancelled-auth" || failure === "expired-session") {
        throw explorerError(failure, schemaResult.error.message, schemaResult.error);
      }
      if (failure === "denied-capability") {
        explorerLog("warn", "sql.discovery", "SQL catalog needs permission", {
          space: space.id,
          database,
          ...failureDetails(schemaResult.error),
        });
        return {
          id: sqlResourceId(space.id, database),
          name: database,
          path: database,
          kind: "sql",
          access: "needs-permission",
          owner: space.owner,
          grantedBy: null,
          expiresAt: null,
          size: null,
          updatedAt: null,
          permissions: resourcePermissions("needs-permission", "sql"),
          evidence: [
            {
              id: "session",
              label: "Session established",
              detail: `address: ${shortAddress(this.sessionOf(tcw)?.address ?? space.owner)}`,
              timestamp: nowIso(),
              verified: true,
            },
            {
              id: "resource",
              label: "Additional permission required",
              detail: `The ${database} SQL database is visible, but its catalog is not readable.`,
              timestamp: nowIso(),
              verified: true,
            },
          ],
          tables: [],
          cannedQueries: [],
        };
      }
      if (failure === "network-error") {
        explorerLog("error", "sql.discovery", "SQL catalog request failed", {
          space: space.id,
          database,
          ...failureDetails(schemaResult.error),
        });
        return null;
      }
      return null;
    }

    const tables: SqlTable[] = [];
    for (const row of schemaResult.data.rows) {
      const tableName = String(row[0] ?? "");
      if (!tableName) continue;
      tables.push({
        name: tableName,
        rowCount: null,
        columns: [],
        rows: [],
        loaded: false,
      });
    }

    if (tables.length === 0) {
      explorerLog("info", "sql.discovery", "SQL catalog is empty", {
        space: space.id,
        database,
      });
      return null;
    }

    explorerLog("info", "sql.discovery", "SQL tables discovered", {
      space: space.id,
      database,
      tables: tables.map((table) => table.name),
    });

    return {
      id: sqlResourceId(space.id, database),
      name: database,
      path: database,
      kind: "sql",
      access,
      owner: space.owner,
      grantedBy: null,
      expiresAt: null,
      size: null,
      updatedAt: null,
      permissions: resourcePermissions(access, "sql"),
      evidence: [
        {
          id: "session",
          label: "Session established",
          detail: `address: ${shortAddress(this.sessionOf(tcw)?.address ?? space.owner)}`,
          timestamp: nowIso(),
          verified: true,
        },
        {
          id: "space",
          label: "SQL catalog discovered",
          detail: `${formatCount(tables.length)} tables or views visible`,
          timestamp: nowIso(),
          verified: true,
        },
      ],
      tables,
      cannedQueries: tables.length > 0
        ? [
            {
              id: "preview",
              label: `Preview ${tables[0].name}`,
              sql: `SELECT * FROM ${quoteIdentifier(tables[0].name)} LIMIT 20;`,
            },
          ]
        : [],
    };
  }

  private async discoverKvResources(
    tcw: TinyCloudWeb,
    space: TinyCloudSpace,
    access: AccessMode,
    prefix = "",
  ): Promise<KvResource[]> {
    explorerLog("debug", "kv.discovery", "Listing KV keys", {
      space: space.id,
      prefix,
    });
    const kv = this.kvServiceForSpace(tcw, space.id);
    const listResult = await retryTransientFailure(() =>
      kv.list({ prefix, limit: 1000 }),
    );
    if (!listResult.ok) {
      const failure = classifyExplorerFailure(listResult.error);
      if (failure === "cancelled-auth" || failure === "expired-session") {
        throw explorerError(failure, listResult.error.message, listResult.error);
      }
      if (failure === "network-error") {
        explorerLog("error", "kv.discovery", "KV list request failed", {
          space: space.id,
          ...failureDetails(listResult.error),
        });
        return [];
      }
      explorerLog("warn", "kv.discovery", "KV keys are not readable", {
        space: space.id,
        ...failureDetails(listResult.error),
      });
      return [];
    }

    const byPrefix = new Map<string, string[]>();
    for (const key of listResult.data.keys) {
      const prefix = topLevelPrefix(key);
      const keys = byPrefix.get(prefix) ?? [];
      keys.push(key);
      byPrefix.set(prefix, keys);
    }

    const resources: KvResource[] = [];
    for (const [prefix, keys] of byPrefix.entries()) {
      const entries: KvEntry[] = [];
      for (let start = 0; start < keys.length; start += 10) {
        const batch = await Promise.all(
          keys.slice(start, start + 10).map(async (key): Promise<KvEntry | null> => {
            const valueResult = await retryTransientFailure(() =>
              kv.get<unknown>(key, { raw: true }),
            );
            if (!valueResult.ok) {
              const failure = classifyExplorerFailure(valueResult.error);
              if (failure === "denied-capability") {
                return {
                  key,
                  value: null,
                  contentType: "Unknown",
                  size: null,
                  updatedAt: null,
                  cid: "unavailable",
                  encrypted: null,
                  hidden: true,
                };
              }
              if (failure === "network-error") {
                return null;
              }
              throw explorerError(
                failure,
                valueResult.error.message,
                valueResult.error,
              );
            }

            const headers = valueResult.data.headers;
            return {
              key,
              value: valueResult.data.data,
              contentType: headers.contentType ?? "Unknown",
              size: headers.contentLength ?? null,
              updatedAt: headers.lastModified ?? null,
              cid: headers.etag ?? "unavailable",
              encrypted: null,
            };
          }),
        );
        entries.push(...batch.filter((entry): entry is KvEntry => entry !== null));
      }

      let size: number | null = entries.length === keys.length ? 0 : null;
      let updatedAt: string | null = null;
      let latestTimestamp = Number.NEGATIVE_INFINITY;
      let allDatesKnown = entries.length > 0 && entries.length === keys.length;
      for (const entry of entries) {
        size = size === null || entry.size === null ? null : size + entry.size;
        if (entry.updatedAt === null) {
          allDatesKnown = false;
        } else {
          const timestamp = Date.parse(entry.updatedAt);
          if (Number.isNaN(timestamp)) allDatesKnown = false;
          else if (timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
            updatedAt = entry.updatedAt;
          }
        }
      }

      resources.push({
        id: kvResourceId(space.id, prefix),
        name: prefix,
        path: prefix,
        kind: "kv",
        access,
        owner: space.owner,
        grantedBy: null,
        expiresAt: null,
        size,
        updatedAt: allDatesKnown ? updatedAt : null,
        permissions: resourcePermissions(access, "kv"),
        evidence: [
          {
            id: "session",
            label: "Session established",
            detail: `address: ${shortAddress(this.sessionOf(tcw)?.address ?? space.owner)}`,
            timestamp: nowIso(),
            verified: true,
          },
          {
            id: "resource",
            label: "KV keys discovered",
            detail: `${formatCount(entries.length)} keys visible`,
            timestamp: nowIso(),
            verified: true,
          },
        ],
        entries,
      });
    }

    explorerLog("info", "kv.discovery", "KV resources discovered", {
      space: space.id,
      keys: listResult.data.keys.length,
      resources: resources.map((resource) => resource.path),
    });
    return resources;
  }

  private async discoverSpace(
    tcw: TinyCloudWeb,
    visibleSpace: TinyCloudSpace,
    sessionAddress: string,
    routable: boolean,
    onProgress?: (space: TinyCloudSpace) => void,
  ): Promise<TinyCloudSpace> {
    const resourceGroups: TinyCloudResource[] = [];
    const publishResources = (...resources: TinyCloudResource[]) => {
      for (const resource of resources) {
        const existingIndex = resourceGroups.findIndex(
          (candidate) => candidate.id === resource.id,
        );
        if (existingIndex >= 0) resourceGroups[existingIndex] = resource;
        else resourceGroups.push(resource);
      }
      resourceGroups.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "sql" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      visibleSpace.resources = [...resourceGroups];
      visibleSpace.resourceCount = resourceGroups.length;
      this.resourcesBySpace.set(visibleSpace.id, [...resourceGroups]);
      onProgress?.(structuredClone(visibleSpace));
    };
    const isSecretsSpace =
      visibleSpace.name === REAL_FIXTURE_SECRETS_SPACE ||
      visibleSpace.id.endsWith(`:${REAL_FIXTURE_SECRETS_SPACE}`);
    const kvPrefixes =
      visibleSpace.name === "public"
        ? ["notes/", "projects/"]
        : visibleSpace.name === "applications"
          ? ["manifests/", "settings/"]
          : visibleSpace.name === "account"
            ? ["spaces/", "delegations/"]
            : [];
    if (isSecretsSpace) {
      visibleSpace.access = "read-only";
      if (routable) {
        await Promise.all([
          this.discoverSqlResource(tcw, visibleSpace, "read-only").then(
            (resource) => {
              if (!resource) return;
              visibleSpace.access = resource.access;
              publishResources(resource);
            },
          ),
          this.discoverKvResources(
            tcw,
            visibleSpace,
            "read-only",
            "vault/secrets/",
          ).then((resources) => publishResources(...resources)),
          this.discoverKvResources(
            tcw,
            visibleSpace,
            "read-only",
            "variables/",
          ).then((resources) => publishResources(...resources)),
        ]);
      } else {
        const sqlResource = secretsSqlResource(visibleSpace, sessionAddress);
        visibleSpace.access = sqlResource.access;
        publishResources(sqlResource);
      }
    } else if (routable) {
      await Promise.all([
        this.discoverSqlResource(tcw, visibleSpace, visibleSpace.access).then(
          (resource) => {
            if (resource) publishResources(resource);
          },
        ),
        ...kvPrefixes.map((prefix) =>
          this.discoverKvResources(
            tcw,
            visibleSpace,
            visibleSpace.access,
            prefix,
          ).then((resources) => publishResources(...resources)),
        ),
      ]);
      if (
        !resourceGroups.some((resource) => resource.kind === "kv") &&
        (visibleSpace.name === "public" || visibleSpace.name === "applications")
      ) {
        publishResources(
          ...(await this.discoverKvResources(
            tcw,
            visibleSpace,
            visibleSpace.access,
            "",
          )),
        );
      }
    } else {
      visibleSpace.access = "needs-permission";
    }

    visibleSpace.discoveryState = "ready";
    publishResources();
    return visibleSpace;
  }

  private async refreshSpace(
    tcw: TinyCloudWeb,
    spaceId: string,
  ): Promise<TinyCloudSpace> {
    const session = this.sessionOf(tcw);
    const currentSnapshot = this.snapshot;
    const currentSpace = currentSnapshot?.spaces.find(
      (candidate) => candidate.id === spaceId,
    );
    if (!session || !currentSnapshot || !currentSpace) {
      throw explorerError("expired-session", "TinyCloud session expired. Sign in again.");
    }

    const visibleSpace = structuredClone(currentSpace);
    if (this.approvedSpaceIds.has(spaceId)) {
      visibleSpace.access = "read-only";
    }
    const updated = await this.discoverSpace(
      tcw,
      visibleSpace,
      session.address,
      true,
    );
    const spaces = currentSnapshot.spaces.map((space) =>
      space.id === spaceId ? updated : space,
    );
    this.snapshot = {
      ...currentSnapshot,
      spaces,
      evidence: currentSnapshot.evidence.map((step) =>
        step.id === "resource"
          ? {
              ...step,
              detail: `${formatCount(spaces.reduce(
                (count, space) => count + space.resources.length,
                0,
              ))} visible`,
              timestamp: nowIso(),
            }
          : step,
      ),
    };
    return updated;
  }

  private async buildSnapshot(
    tcw: TinyCloudWeb,
    onSnapshot?: ExplorerSnapshotListener,
  ): Promise<ExplorerSnapshot> {
    const session = this.sessionOf(tcw);
    if (!session) {
      throw explorerError("expired-session", "TinyCloud session expired. Sign in again.");
    }

    const identity: ExplorerIdentity = {
      address: session.address,
      did: this.embedded?.owner?.did ?? tcw.did,
      sessionDid: tcw.sessionDid,
      nodeUrl: this.config.tinycloudHost,
    };
    let spaces = this.knownOwnedSpaces(tcw).map((space) =>
      this.materializeSpace(space, session.address),
    );
    spaces.sort((a, b) => this.compareSpaces(a, b));
    this.resourcesBySpace.clear();

    const publishSnapshot = (
      phase: "spaces" | "resources" | "ready",
    ): ExplorerSnapshot => {
      const completedSpaces = spaces.filter(
        (space) => space.discoveryState === "ready",
      ).length;
      const resourceCount = spaces.reduce(
        (count, space) => count + space.resources.length,
        0,
      );
      const snapshot: ExplorerSnapshot = {
        identity,
        spaces: structuredClone(spaces),
        evidence: [
          {
            id: "session",
            label: "Session established",
            detail: shortAddress(session.address),
            timestamp: nowIso(),
            verified: true,
          },
          {
            id: "delegation",
            label: "OpenKey-backed SIWE session",
            detail: tcw.isWalletConnected
              ? "external wallet path"
              : "managed OpenKey path",
            timestamp: nowIso(),
            verified: true,
          },
          {
            id: "space",
            label: phase === "spaces" ? "Discovering spaces" : "Spaces discovered",
            detail:
              phase === "spaces"
                ? `${formatCount(spaces.length)} expected`
                : `${formatCount(spaces.length)} visible`,
            timestamp: nowIso(),
            verified: phase !== "spaces",
          },
          {
            id: "resource",
            label:
              phase === "ready"
                ? "Resources discovered"
                : "Discovering resources",
            detail:
              phase === "ready"
                ? `${formatCount(resourceCount)} visible`
                : `${formatCount(completedSpaces)} of ${formatCount(spaces.length)} spaces ready`,
            timestamp: nowIso(),
            verified: phase === "ready",
          },
        ],
        discovery: {
          phase,
          completedSpaces,
          totalSpaces: spaces.length,
        },
      };
      this.snapshot = snapshot;
      onSnapshot?.(structuredClone(snapshot));
      return snapshot;
    };

    // A valid TinyCloud session is enough to enter Explorer. Known canonical
    // spaces form the initial shell while the node-backed index is still
    // loading.
    publishSnapshot("spaces");

    // Session-only embedded sessions cannot list spaces; Explorer's own three
    // are known and One's delegations say which are granted.
    let listedSpaces: SpaceInfo[] = [];
    if (!this.embedded) {
      explorerLog("debug", "spaces", "Listing TinyCloud spaces");
      const spaceResult = await tcw.spaces.list();
      if (!spaceResult.ok) {
        explorerLog("error", "spaces", "Space discovery failed", {
          ...failureDetails(spaceResult.error),
        });
        throw explorerError(
          classifyExplorerFailure(spaceResult.error),
          spaceResult.error.message,
          spaceResult.error,
        );
      }
      explorerLog("info", "spaces", "TinyCloud spaces listed", {
        listed: spaceResult.data.map((space) => space.name ?? space.id),
      });
      listedSpaces = spaceResult.data;
    }

    // Dedup known spaces against listed spaces by canonical URI so a short-id
    // owned space (e.g. "public") is never materialized twice. Listed spaces
    // win because they carry the real permission set.
    const rawByUri = new Map<string, SpaceInfo>();
    const routableUris = new Set<string>();
    const preferredSpace = this.preferredSpaceName();
    for (const knownSpace of this.knownOwnedSpaces(tcw)) {
      const uri = canonicalSpaceUri(knownSpace);
      rawByUri.set(uri, knownSpace);
      if (
        preferredSpace &&
        (knownSpace.name === preferredSpace || uri.endsWith(`:${preferredSpace}`))
      ) {
        routableUris.add(uri);
      }
      if (
        knownSpace.name === REAL_FIXTURE_SECRETS_SPACE ||
        uri.endsWith(`:${REAL_FIXTURE_SECRETS_SPACE}`)
      ) {
        routableUris.add(uri);
      }
    }
    for (const space of listedSpaces) {
      const uri = canonicalSpaceUri(space);
      rawByUri.set(uri, space);
      routableUris.add(uri);
    }
    for (const spaceId of this.approvedSpaceIds) {
      routableUris.add(spaceId);
    }
    if (this.embedded) {
      // Routable means One delegated it; nothing is assumed from the manifest.
      routableUris.clear();
      for (const spaceId of this.embedded.grantedSpaceIds()) {
        routableUris.add(spaceId);
      }
    }

    spaces = [...rawByUri.values()].map((space) => {
      const visibleSpace = this.materializeSpace(space, session.address);
      if (this.approvedSpaceIds.has(visibleSpace.id)) {
        visibleSpace.access = "read-only";
      }
      return visibleSpace;
    });
    spaces.sort((a, b) => this.compareSpaces(a, b));

    if (spaces.length === 0) {
      throw explorerError("empty-space", "This session can see no TinyCloud spaces.");
    }

    publishSnapshot("resources");

    await Promise.all(
      spaces.map(async (visibleSpace) => {
        const updateVisibleSpace = (updated: TinyCloudSpace) => {
          const index = spaces.findIndex(
            (candidate) => candidate.id === updated.id,
          );
          if (index >= 0) spaces[index] = updated;
          spaces.sort((a, b) => this.compareSpaces(a, b));
          publishSnapshot("resources");
        };
        const updated = await this.discoverSpace(
          tcw,
          visibleSpace,
          session.address,
          routableUris.has(visibleSpace.id),
          updateVisibleSpace,
        );
        updateVisibleSpace(updated);
      }),
    );

    const snapshot = publishSnapshot("ready");
    explorerLog("info", "snapshot", "Explorer snapshot ready", {
      spaces: spaces.length,
      resources: spaces.reduce(
        (count, space) => count + space.resources.length,
        0,
      ),
    });
    return snapshot;
  }

  // One handshake at a time: React StrictMode and repeat clicks must not send
  // a second hello, and a retry after silence reuses the same session key.
  private connectEmbedded(onSnapshot?: ExplorerSnapshotListener): Promise<ExplorerSnapshot> {
    this.embeddedConnect ??= this.runEmbeddedConnect(onSnapshot).finally(() => {
      this.embeddedConnect = null;
    });
    return this.embeddedConnect;
  }

  private async runEmbeddedConnect(onSnapshot?: ExplorerSnapshotListener): Promise<ExplorerSnapshot> {
    const embedded = this.config.embedded;
    if (!embedded) throw explorerError("unknown", "Explorer is not embedded.");
    installExplorerHttpLogging([this.config.tinycloudHost]);
    const finishConnection = startExplorerOperation("auth", "TinyCloud connection", {
      tinycloudHost: this.config.tinycloudHost,
      embeddedIn: embedded.parentOrigin,
    });
    const session =
      this.embedded ??
      (embedded.createSession ?? ((config) => new OneEmbedSession(config)))({
        win: window,
        parentOrigin: embedded.parentOrigin,
        tinycloudHost: this.config.tinycloudHost,
        onTheme: embedded.onTheme,
        onRevoked: embedded.onRevoked,
      });
    this.embedded = session;
    try {
      await session.start();
      const tcw = session.tcw;
      explorerLog("info", "auth", "Delegation received from TinyCloud One", {
        address: session.owner?.address,
        sessionDid: tcw.sessionDid,
        spaces: session.grantedSpaceIds(),
      });
      this.tcw = tcw;
      const snapshot = await this.buildSnapshot(tcw, onSnapshot);
      finishConnection({
        outcome: "ok",
        details: {
          spaces: snapshot.spaces.length,
          resources: snapshot.spaces.reduce(
            (count, space) => count + space.resources.length,
            0,
          ),
        },
      });
      return snapshot;
    } catch (error) {
      this.tcw = null;
      finishConnection({
        outcome: "error",
        error,
        details: failureDetails(error),
      });
      throw error;
    }
  }

  /**
   * Standalone only: bring back a session saved by an earlier sign-in without opening OpenKey. A session past its
   * signed end comes back only through its own verified renewal receipt; otherwise this resolves null and the owner
   * signs in as usual.
   */
  restore(onSnapshot?: ExplorerSnapshotListener): Promise<ExplorerSnapshot | null> {
    if (this.config.embedded) return Promise.resolve(null);
    this.restoring ??= this.runRestore(onSnapshot).finally(() => {
      this.restoring = null;
    });
    return this.restoring;
  }

  private async runRestore(onSnapshot?: ExplorerSnapshotListener): Promise<ExplorerSnapshot | null> {
    const storage = this.sessionStorage();
    const address = storage.activeAddressForRenewal();
    if (!address) return null;
    installExplorerHttpLogging([this.config.tinycloudHost]);
    const finishRestore = startExplorerOperation("auth", "TinyCloud session restore", {
      tinycloudHost: this.config.tinycloudHost,
    });
    try {
      const tcw = this.makeRestoredTinyCloudWeb(address);
      const renewal = await renewalRestoreFor(storage);
      const result = renewal
        ? await tcw.restoreSessionWithRenewal(renewal.leaseAuthorization, renewal.address)
        : await tcw.restoreSession(address);
      if (result.status !== "restored") {
        if (renewal) {
          // The node no longer renews this session: drop what would only be tried again.
          clearRenewalReceipt(renewal.address);
          await tcw.clearPersistedSession(renewal.address);
        }
        tcw.cleanup?.();
        finishRestore({
          outcome: "ok",
          details: { restored: false, status: result.status, renewed: renewal !== null },
        });
        return null;
      }
      this.tcw = tcw;
      explorerLog("info", "auth", "TinyCloud session restored", {
        address: tcw.session()?.address,
        renewed: renewal !== null,
      });
      const snapshot = await this.buildSnapshot(tcw, onSnapshot);
      finishRestore({ outcome: "ok", details: { restored: true, renewed: renewal !== null } });
      return snapshot;
    } catch (error) {
      this.tcw = null;
      finishRestore({ outcome: "error", error, details: failureDetails(error) });
      return null;
    }
  }

  async connect(
    onSnapshot?: ExplorerSnapshotListener,
    options?: ConnectOptions,
  ): Promise<ExplorerSnapshot> {
    if (this.config.embedded) return this.connectEmbedded(onSnapshot);
    installExplorerHttpLogging([
      this.config.openKeyHost,
      this.config.tinycloudHost,
    ]);
    const finishConnection = startExplorerOperation("auth", "TinyCloud connection", {
      openKeyHost: this.config.openKeyHost,
      tinycloudHost: this.config.tinycloudHost,
      renewal: options?.renewal === true,
    });
    try {
      const openkey = this.makeOpenKey();
      const connect = this.config.connectOpenKey ?? ((instance: OpenKey) => instance.connect());
      const auth = await connect(openkey);
      explorerLog("info", "auth", "Wallet selected", {
        address: auth.address,
        keyType: auth.keyType,
      });
      // Without the owner's opt-in there is no capture, no ask, and the sign-in is finite.
      const capture: RenewalCapture | null = options?.renewal ? { outcome: {} } : null;
      const tcw = await this.makeTinyCloudWeb(openkey, auth, capture);
      explorerLog("info", "auth", "Requesting capability-bearing TinyCloud SIWE");
      await tcw.signIn();
      explorerLog("info", "auth", "TinyCloud session established", {
        address: tcw.session()?.address,
        sessionDid: tcw.sessionDid,
        primarySpace: tcw.spaceId,
      });
      await this.keepRenewal(tcw, capture);
      this.tcw = tcw;
      const snapshot = await this.buildSnapshot(tcw, onSnapshot);
      finishConnection({
        outcome: "ok",
        details: {
          spaces: snapshot.spaces.length,
          resources: snapshot.spaces.reduce(
            (count, space) => count + space.resources.length,
            0,
          ),
        },
      });
      return snapshot;
    } catch (error) {
      finishConnection({
        outcome: "error",
        error,
        details: failureDetails(error),
      });
      throw error;
    }
  }

  /**
   * Has the node admit the lease an opted-in sign-in returned and keeps it as the session's receipt. Any other
   * sign-in, or one whose lease is missing, refused or not admitted, keeps no receipt: it ends at its signed end.
   */
  private async keepRenewal(tcw: TinyCloudWeb, capture: RenewalCapture | null): Promise<void> {
    const address = tcw.session()?.address;
    if (!address) return;
    const renewing = capture
      ? await admitSignInRenewal({
          tcw,
          address,
          renewal: capture.outcome.renewal,
          arrivedAt: capture.arrivedAt,
          sessionStorage: this.sessionStorage(),
        })
      : false;
    if (!renewing) clearRenewalReceipt(address);
    explorerLog(
      "info",
      "auth",
      renewing ? "Renewal lease admitted" : "No renewal: this sign-in ends at its signed end",
    );
  }

  async disconnect(): Promise<void> {
    const tcw = this.tcw;
    const embedded = this.embedded;
    this.tcw = null;
    this.embedded = null;
    this.snapshot = null;
    this.resourcesBySpace.clear();
    this.approvedSpaceIds.clear();
    explorerLog("info", "auth", "Disconnecting TinyCloud session");
    if (embedded) {
      embedded.stop();
    } else if (tcw) {
      const address = tcw.session?.()?.address;
      try {
        await tcw.signOut?.();
      } finally {
        if (address) clearRenewalReceipt(address);
      }
    }
    explorerLog("info", "auth", "TinyCloud session disconnected");
  }

  async listSpaces(): Promise<TinyCloudSpace[]> {
    if (this.snapshot) return structuredClone(this.snapshot.spaces);
    const tcw = await this.ensureTinyCloud();
    const snapshot = await this.buildSnapshot(tcw);
    return structuredClone(snapshot.spaces);
  }

  async runQuery(spaceId: string, resourceId: string, sql: string): Promise<SqlQueryResult> {
    const tcw = await this.ensureTinyCloud();
    const space = this.snapshot?.spaces.find((candidate) => candidate.id === spaceId);
    const resource = space?.resources.find((candidate) => candidate.id === resourceId);
    if (!resource || resource.kind !== "sql") {
      throw explorerError("unsupported-resource", "This resource cannot be queried.");
    }

    explorerLog("info", "sql.query", "Running SQL query", {
      space: spaceId,
      database: resource.path,
      statement: sql.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? "",
      characters: sql.length,
    });
    const result = await retryTransientFailure(() =>
      this.sqlDatabase(tcw, spaceId, resource.path).query(sql),
    );
    if (!result.ok) {
      explorerLog("error", "sql.query", "SQL query failed", {
        space: spaceId,
        database: resource.path,
        ...failureDetails(result.error),
      });
      throw explorerError(
        classifyExplorerFailure(result.error),
        result.error.message,
        result.error,
      );
    }

    const mapped = mapQueryResult({
      columns: result.data.columns,
      rows: result.data.rows,
      rowCount: result.data.rowCount,
    });
    explorerLog("info", "sql.query", "SQL query completed", {
      space: spaceId,
      database: resource.path,
      rows: mapped.rows.length,
      columns: mapped.columns.map((column) => column.name),
    });
    return mapped;
  }

  private resolveKvKey(resource: KvResource, key: string): string {
    const trimmed = key.trim().replace(/^\/+/, "");
    if (!trimmed) {
      throw explorerError("unsupported-resource", "A KV key name is required.");
    }
    if (!resource.path) return trimmed;
    // The workspace lists entries by their full key, so a delete/write can pass
    // a key that already carries the resource prefix. Prepend the prefix only
    // when it is missing to avoid producing `<prefix>/<prefix>/...`.
    if (trimmed === resource.path || trimmed.startsWith(`${resource.path}/`)) {
      return trimmed;
    }
    return `${resource.path}/${trimmed}`;
  }

  private async refreshKvResource(spaceId: string, resourceId: string): Promise<KvResource> {
    const nextSpace = await this.refreshSpace(await this.ensureTinyCloud(), spaceId);
    const updated = nextSpace.resources.find(
      (candidate): candidate is KvResource =>
        candidate.kind === "kv" && candidate.id === resourceId,
    );
    if (!updated) {
      throw explorerError("unsupported-resource", "The KV resource could not be refreshed.");
    }
    return updated;
  }

  async writeKvEntry(
    spaceId: string,
    resourceId: string,
    key: string,
    value: unknown,
  ): Promise<KvResource> {
    const tcw = await this.ensureTinyCloud();
    const space = this.snapshot?.spaces.find((candidate) => candidate.id === spaceId);
    const resource = space?.resources.find((candidate) => candidate.id === resourceId);
    const specialSpaceRoot = resourceId === "__space__";
    if ((!resource || resource.kind !== "kv") && !specialSpaceRoot) {
      throw explorerError("unsupported-resource", "This resource cannot be written.");
    }
    if ((resource?.access ?? space?.access) !== "read-write") {
      throw explorerError("denied-capability", "This KV resource is read only.");
    }

    const fullKey = specialSpaceRoot
      ? key.trim().replace(/^\/+/, "")
      : this.resolveKvKey(resource as KvResource, key);
    explorerLog("info", "kv.write", "Writing KV entry", {
      space: spaceId,
      resource: resource?.path ?? "",
      key: fullKey,
    });
    const result = await this.kvServiceForSpace(tcw, spaceId).put(fullKey, value);
    if (!result.ok) {
      explorerLog("error", "kv.write", "KV write failed", {
        space: spaceId,
        key: fullKey,
        ...failureDetails(result.error),
      });
      throw explorerError(
        classifyExplorerFailure(result.error),
        result.error.message,
        result.error,
      );
    }
    explorerLog("info", "kv.write", "KV entry written", {
      space: spaceId,
      key: fullKey,
    });

    const nextResourceId = specialSpaceRoot
      ? kvResourceId(spaceId, topLevelPrefix(fullKey))
      : resourceId;
    return this.refreshKvResource(spaceId, nextResourceId);
  }

  async deleteKvEntry(
    spaceId: string,
    resourceId: string,
    key: string,
  ): Promise<KvResource> {
    const tcw = await this.ensureTinyCloud();
    const space = this.snapshot?.spaces.find((candidate) => candidate.id === spaceId);
    const resource = space?.resources.find((candidate) => candidate.id === resourceId);
    const specialSpaceRoot = resourceId === "__space__";
    if ((!resource || resource.kind !== "kv") && !specialSpaceRoot) {
      throw explorerError("unsupported-resource", "This resource cannot be deleted.");
    }

    const fullKey = specialSpaceRoot
      ? key.trim().replace(/^\/+/, "")
      : this.resolveKvKey(resource as KvResource, key);
    explorerLog("info", "kv.delete", "Deleting KV entry", {
      space: spaceId,
      key: fullKey,
    });
    const result = await this.kvServiceForSpace(tcw, spaceId).delete(fullKey);
    if (!result.ok) {
      explorerLog("error", "kv.delete", "KV delete failed", {
        space: spaceId,
        key: fullKey,
        ...failureDetails(result.error),
      });
      throw explorerError(
        classifyExplorerFailure(result.error),
        result.error.message,
        result.error,
      );
    }
    explorerLog("info", "kv.delete", "KV entry deleted", {
      space: spaceId,
      key: fullKey,
    });

    const nextResourceId = specialSpaceRoot
      ? kvResourceId(spaceId, topLevelPrefix(fullKey))
      : resourceId;
    try {
      return await this.refreshKvResource(spaceId, nextResourceId);
    } catch (error) {
      if (
        specialSpaceRoot ||
        (error instanceof Error &&
          classifyExplorerFailure(error) === "unsupported-resource")
      ) {
        return emptyKvResource(
          spaceId,
          space ?? {
            id: spaceId,
            name: spaceId,
            uri: spaceId,
            owner: this.sessionOf(tcw)?.address ?? spaceId,
            resourceCount: 0,
            access: "read-write",
            resources: [],
            evidence: [],
          },
          resource?.path ?? topLevelPrefix(fullKey),
        );
      }
      throw error;
    }
  }

  async grantPermission(spaceId: string, resourceId: string): Promise<TinyCloudResource> {
    const tcw = await this.ensureTinyCloud();
    const space = this.snapshot?.spaces.find((candidate) => candidate.id === spaceId);
    const resource = space?.resources.find((candidate) => candidate.id === resourceId);
    if (!resource) {
      throw explorerError("unsupported-resource", "The selected resource is no longer available.");
    }

    const permissions = this.permissionEntriesFor(resource, spaceId);
    if (permissions.length === 0) {
      throw explorerError("unsupported-resource", "This resource does not support access escalation.");
    }

    explorerLog("info", "permissions", "Requesting resource permission", {
      space: spaceId,
      resource: resource.path,
      permissions,
    });
    const response = await this.requestPermissions(tcw, permissions);
    if (!response.approved) {
      explorerLog("warn", "permissions", "Resource permission was denied", {
        space: spaceId,
        resource: resource.path,
      });
      throw explorerError("denied-capability", "OpenKey denied the access request.");
    }
    explorerLog("info", "permissions", "Resource permission approved", {
      space: spaceId,
      resource: resource.path,
      delegations: response.delegations?.length ?? 0,
    });

    this.approvedSpaceIds.add(spaceId);
    const nextSpace = await this.refreshSpace(tcw, spaceId);
    const updated = nextSpace.resources.find((candidate) => candidate.id === resourceId);
    if (!updated) {
      throw explorerError("unsupported-resource", "The resource disappeared after approval.");
    }
    return updated;
  }

  async grantSpacePermissions(spaceId: string): Promise<TinyCloudSpace> {
    const tcw = await this.ensureTinyCloud();
    const space = this.snapshot?.spaces.find((candidate) => candidate.id === spaceId);
    if (!space) {
      throw explorerError("unsupported-resource", "The selected space is no longer available.");
    }

    const permissions: PermissionEntry[] = this.embedded
      ? embeddedPermissionsFor(spaceId)
      : [
          {
            service: "tinycloud.capabilities",
            space: spaceId,
            path: "",
            actions: ["tinycloud.capabilities/read"],
          },
          {
            service: "tinycloud.kv",
            space: spaceId,
            path: "",
            actions: [
              "tinycloud.kv/get",
              "tinycloud.kv/list",
              "tinycloud.kv/metadata",
            ],
          },
          {
            service: "tinycloud.sql",
            space: spaceId,
            path: sqlDatabaseForSpace(space),
            actions: ["tinycloud.sql/read"],
          },
        ];
    explorerLog("info", "permissions", "Requesting space discovery permission", {
      space: spaceId,
      permissions,
    });
    const response = await this.requestPermissions(tcw, permissions);
    if (!response.approved) {
      explorerLog("warn", "permissions", "Space discovery permission was denied", {
        space: spaceId,
      });
      throw explorerError("denied-capability", "OpenKey denied the access request.");
    }
    explorerLog("info", "permissions", "Space discovery permission approved", {
      space: spaceId,
      delegations: response.delegations?.length ?? 0,
    });

    this.approvedSpaceIds.add(spaceId);
    return this.refreshSpace(tcw, spaceId);
  }

  private permissionEntriesFor(resource: TinyCloudResource, spaceId: string): PermissionEntry[] {
    if (resource.kind === "sql") {
      return [{
        service: "tinycloud.sql",
        space: spaceId,
        path: resource.path,
        actions: ["tinycloud.sql/read"],
      }];
    }

    return [{
      service: "tinycloud.kv",
      space: spaceId,
      path: resource.path ? `${resource.path.replace(/\/+$/g, "")}/` : "",
      actions: resource.access === "read-write"
        ? ["tinycloud.kv/put"]
        : ["tinycloud.kv/get"],
    }];
  }
}
