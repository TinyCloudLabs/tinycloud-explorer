import { OpenKey, OpenKeyProvider, type AuthResult } from "@openkey/sdk";
import { providers } from "ethers";
import {
  TinyCloudWeb,
  type Manifest,
  type PermissionEntry,
} from "@tinycloud/web-sdk";
import { buildSpaceUri } from "@tinycloud/sdk-core";
import type { SpaceInfo } from "@tinycloud/sdk-core";

import type {
  AccessMode,
  CapabilityStep,
  ExplorerDataSource,
  ExplorerIdentity,
  ExplorerSnapshot,
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
  ) => Promise<TinyCloudWeb> | TinyCloudWeb;
}

type PublicSpaceNode = {
  ensurePublicSpace?: () => Promise<void>;
  publicKV?: ReturnType<TinyCloudWeb["kvForSpace"]>;
};

function nowIso(): string {
  return new Date().toISOString();
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
    grantedBy: space.owner,
    expiresAt: nowIso(),
    size: 0,
    updatedAt: nowIso(),
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

export class RealExplorerDataSource implements ExplorerDataSource {
  readonly mode = "real" as const;

  private tcw: TinyCloudWeb | null = null;
  private snapshot: ExplorerSnapshot | null = null;
  private bootstrapSpaceInfo: SpaceInfo | null = null;
  private readonly resourcesBySpace = new Map<string, TinyCloudResource[]>();

  constructor(private readonly config: RealExplorerDataSourceConfig) {}

  private makeOpenKey(): OpenKey {
    return this.config.createOpenKey?.() ?? new OpenKey({
      host: this.config.openKeyHost,
      appName: this.config.appName ?? "TinyCloud Explorer",
    });
  }

  private async makeTinyCloudWeb(openkey: OpenKey, auth: AuthResult): Promise<TinyCloudWeb> {
    const web3Provider = new providers.Web3Provider(
      new OpenKeyProvider(openkey, auth) as unknown as providers.ExternalProvider,
    );
    const create = this.config.createTinyCloudWeb;
    if (create) return create(auth, openkey, web3Provider);

    const tcw = new TinyCloudWeb({
      providers: {
        web3: {
          driver: web3Provider,
        },
      },
      provider: web3Provider,
      tinycloudHosts: [this.config.tinycloudHost],
      tinycloudFallbackHosts: null,
      tinycloudRegistryUrl: null,
      autoDiscoverLocalNode: false,
      // Explorer signs in first, then provisions its preferred owned space via
      // `bootstrapPreferredSpace`. Avoid blocking the interactive OpenKey
      // external-wallet sign-in on creation of a space that is not hosted yet.
      autoCreateSpace: false,
      kvPrefix: this.config.kvPrefix ?? this.config.spacePrefix ?? "explorer",
      spacePrefix: this.config.spacePrefix ?? "explorer",
      sessionStorageKeyPrefix: this.config.sessionStorageKeyPrefix ?? "tinycloud-explorer",
      persistSession: true,
      manifest: this.manifestForSession(auth),
    });
    tcw.provider = web3Provider;
    return tcw;
  }

  private manifestForSession(auth: AuthResult): Manifest {
    const space = this.config.spacePrefix ?? "explorer";
    return {
      app_id: "xyz.tinycloud.explorer",
      name: "TinyCloud Explorer",
      description: "Spatial browser for TinyCloud spaces, SQL tables, and KV data.",
      appVersion: "0.1.0",
      defaults: false,
      prefix: "",
      permissions: [
        {
          service: "tinycloud.kv",
          space,
          path: "/",
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
          path: "/",
          actions: ["tinycloud.sql/read"],
        },
      ],
    };
  }

  private preferredSpaceName(): string | null {
    return (this.config.spacePrefix ?? this.config.kvPrefix ?? "explorer").trim() || null;
  }

  private materializeSpace(space: SpaceInfo, sessionAddress: string): TinyCloudSpace {
    const uri = canonicalSpaceUri(space);
    const configuredSpace = this.config.spacePrefix?.trim();
    const access =
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

  private kvServiceForSpace(tcw: TinyCloudWeb, spaceId: string) {
    if (spaceId.endsWith(":public")) {
      const publicKV = (tcw as unknown as { node?: PublicSpaceNode }).node?.publicKV;
      if (publicKV) return publicKV;
    }
    return tcw.kvForSpace(spaceId);
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

  private async bootstrapPreferredSpace(tcw: TinyCloudWeb): Promise<SpaceInfo | null> {
    const preferred = this.preferredSpaceName();
    const session = tcw.session();
    if (!preferred || !session) return null;

    const resolvedOwner = `did:pkh:eip155:${session.chainId}:${session.address}`;
    const resolvedId = `tinycloud:pkh:eip155:${session.chainId}:${session.address}:${preferred}`;

    if (preferred !== "public" && typeof tcw.ensureOwnedSpaceHosted === "function") {
      try {
        await tcw.ensureOwnedSpaceHosted(preferred);
        const afterPreferred = await tcw.spaces.list();
        if (afterPreferred.ok) {
          const foundPreferred = afterPreferred.data.find(
            (space) => space.id === resolvedId || space.name === preferred,
          );
          if (foundPreferred) {
            return foundPreferred;
          }
        }
      } catch {
        // Fall through to the supported public-space bootstrap below.
      }
    }

    try {
      const node = (tcw as unknown as { node?: PublicSpaceNode }).node;
      if (node?.ensurePublicSpace) {
        await node.ensurePublicSpace();
      }
    } catch {
      // The public-space helper is a best-effort reach into the source-backed
      // node implementation; fall back to the owned-space host below.
    }

    if (typeof tcw.ensureOwnedSpaceHosted === "function") {
      try {
        await tcw.ensureOwnedSpaceHosted("public");
      } catch {
        // Public hosting is best-effort here; the subsequent list() call
        // determines whether the session can actually see the space.
      }
    }

    const listResult = await tcw.spaces.list();
    if (listResult.ok) {
      const publicSpace = listResult.data.find((space) => space.name === "public" || space.id.endsWith(":public"));
      if (publicSpace) {
        return publicSpace;
      }
    }

    return {
      id: `tinycloud:pkh:eip155:${session.chainId}:${session.address}:public`,
      name: "public",
      owner: resolvedOwner,
      type: "owned",
      permissions: ["*"],
    };
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
    const sql = tcw.sqlForSpace(space.id).db("default");
    const schemaResult = await sql.query<{ name: string; type: string }>(
      `SELECT name, type
       FROM sqlite_master
       WHERE type IN ('table', 'view')
         AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
    );

    if (!schemaResult.ok) {
      const failure = classifyExplorerFailure(schemaResult.error);
      if (failure === "cancelled-auth" || failure === "expired-session") {
        throw explorerError(failure, schemaResult.error.message, schemaResult.error);
      }
      if (failure === "network-error") return null;
      return null;
    }

    const tables: SqlTable[] = [];
    for (const row of schemaResult.data.rows) {
      const tableName = String(row[0] ?? "");
      if (!tableName) continue;

      const previewResult = await sql.query<Record<string, SqlCell>>(
        `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT 20`,
      );
      if (!previewResult.ok) {
        const failure = classifyExplorerFailure(previewResult.error);
        if (failure === "denied-capability") {
          tables.push({
            name: tableName,
            rowCount: 0,
            columns: [],
            rows: [],
            concealed: true,
          });
          continue;
        }
        if (failure === "network-error") {
          continue;
        }
        throw explorerError(
          failure,
          previewResult.error.message,
          previewResult.error,
        );
      }

      const countResult = await sql.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM ${quoteIdentifier(tableName)}`,
      );
      const rowCount = countResult.ok
        ? Number(countResult.data.rows[0]?.[0] ?? 0)
        : previewResult.data.rowCount;
      tables.push({
        name: tableName,
        rowCount,
        columns: previewResult.data.columns.map((name: string) => ({
          name,
          type: "TEXT",
        })),
        rows: previewResult.data.rows.map((row: readonly unknown[]) =>
          recordRow(previewResult.data.columns, row),
        ),
      });
    }

    if (tables.length === 0) return null;

    return {
      id: sqlResourceId(space.id, "default"),
      name: "default",
      path: "default",
      kind: "sql",
      access,
      owner: space.owner,
      grantedBy: space.owner,
      expiresAt: nowIso(),
      size: null,
      updatedAt: nowIso(),
      permissions: resourcePermissions(access, "sql"),
      evidence: [
        {
          id: "session",
          label: "Session established",
          detail: `address: ${shortAddress(tcw.session()?.address ?? space.owner)}`,
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
  ): Promise<KvResource[]> {
    const kv = this.kvServiceForSpace(tcw, space.id);
    const listResult = await kv.list({ prefix: "", limit: 1000 });
    if (!listResult.ok) {
      const failure = classifyExplorerFailure(listResult.error);
      if (failure === "cancelled-auth" || failure === "expired-session") {
        throw explorerError(failure, listResult.error.message, listResult.error);
      }
      if (failure === "network-error") return [];
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
      for (const key of keys) {
        const valueResult = await kv.get<unknown>(key, { raw: true });
        if (!valueResult.ok) {
          const failure = classifyExplorerFailure(valueResult.error);
          if (failure === "denied-capability") {
            entries.push({
              key,
              value: null,
              contentType: "unknown",
              size: 0,
              updatedAt: nowIso(),
              cid: "unavailable",
              encrypted: null,
              hidden: true,
            });
            continue;
          }
          if (failure === "network-error") {
            continue;
          }
          throw explorerError(
            failure,
            valueResult.error.message,
            valueResult.error,
          );
        }

        const headers = valueResult.data.headers;
        entries.push({
          key,
          value: valueResult.data.data,
          contentType: headers.contentType ?? "application/octet-stream",
          size: headers.contentLength ?? 0,
          updatedAt: headers.lastModified ?? nowIso(),
          cid: headers.etag ?? "unavailable",
          encrypted: null,
        });
      }

      resources.push({
        id: kvResourceId(space.id, prefix),
        name: prefix,
        path: prefix,
        kind: "kv",
        access,
        owner: space.owner,
        grantedBy: space.owner,
        expiresAt: nowIso(),
        size: entries.reduce((total, entry) => total + entry.size, 0),
        updatedAt: entries[0]?.updatedAt ?? nowIso(),
        permissions: resourcePermissions(access, "kv"),
        evidence: [
          {
            id: "session",
            label: "Session established",
            detail: `address: ${shortAddress(tcw.session()?.address ?? space.owner)}`,
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

    return resources;
  }

  private async buildSnapshot(tcw: TinyCloudWeb): Promise<ExplorerSnapshot> {
    const session = tcw.session();
    if (!session) {
      throw explorerError("expired-session", "TinyCloud session expired. Sign in again.");
    }

    const spaceResult = await tcw.spaces.list();
    if (!spaceResult.ok) {
      throw explorerError(
        classifyExplorerFailure(spaceResult.error),
        spaceResult.error.message,
        spaceResult.error,
      );
    }

    const spaces: TinyCloudSpace[] = [];
    this.resourcesBySpace.clear();

    // Dedup the bootstrap space against the listed spaces by canonical URI so a
    // short-id owned space (e.g. "public") is never materialized twice. Listed
    // spaces win because they carry the real permission set.
    const rawByUri = new Map<string, SpaceInfo>();
    if (this.bootstrapSpaceInfo) {
      rawByUri.set(canonicalSpaceUri(this.bootstrapSpaceInfo), this.bootstrapSpaceInfo);
    }
    for (const space of spaceResult.data) {
      rawByUri.set(canonicalSpaceUri(space), space);
    }

    for (const space of rawByUri.values()) {
      const visibleSpace = this.materializeSpace(space, session.address);
      const access = visibleSpace.access;

      const resourceGroups: TinyCloudResource[] = [];
      const [sqlResource, kvResources] = await Promise.all([
        this.discoverSqlResource(tcw, visibleSpace, access),
        this.discoverKvResources(tcw, visibleSpace, access),
      ]);
      if (sqlResource) resourceGroups.push(sqlResource);
      resourceGroups.push(...kvResources);

      visibleSpace.resources = resourceGroups;
      visibleSpace.resourceCount = resourceGroups.length;
      this.resourcesBySpace.set(visibleSpace.id, resourceGroups);
      spaces.push(visibleSpace);
    }

    spaces.sort((a, b) => this.compareSpaces(a, b));

    if (spaces.length === 0) {
      throw explorerError("empty-space", "This session can see no TinyCloud spaces.");
    }

    const snapshot: ExplorerSnapshot = {
      identity: {
        address: session.address,
        did: tcw.did,
        sessionDid: tcw.sessionDid,
        nodeUrl: this.config.tinycloudHost,
      },
      spaces,
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
          detail: tcw.isWalletConnected ? "external wallet path" : "managed OpenKey path",
          timestamp: nowIso(),
          verified: true,
        },
        {
          id: "space",
          label: "Spaces discovered",
          detail: `${formatCount(spaces.length)} visible`,
          timestamp: nowIso(),
          verified: true,
        },
        {
          id: "resource",
          label: "Resources discovered",
          detail: `${formatCount(spaces.reduce((count, space) => count + space.resources.length, 0))} visible`,
          timestamp: nowIso(),
          verified: true,
        },
      ],
    };
    this.snapshot = snapshot;
    return snapshot;
  }

  async connect(): Promise<ExplorerSnapshot> {
    const openkey = this.makeOpenKey();
    const connect = this.config.connectOpenKey ?? ((instance: OpenKey) => instance.connect());
    const auth = await connect(openkey);
    const tcw = await this.makeTinyCloudWeb(openkey, auth);
    await tcw.signIn();
    this.bootstrapSpaceInfo = await this.bootstrapPreferredSpace(tcw);
    this.tcw = tcw;
    return this.buildSnapshot(tcw);
  }

  async disconnect(): Promise<void> {
    const tcw = this.tcw;
    this.tcw = null;
    this.snapshot = null;
    this.bootstrapSpaceInfo = null;
    this.resourcesBySpace.clear();
    if (tcw) {
      await tcw.signOut?.();
    }
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

    const result = await tcw.sqlForSpace(spaceId).db(resource.path).query(sql);
    if (!result.ok) {
      throw explorerError(
        classifyExplorerFailure(result.error),
        result.error.message,
        result.error,
      );
    }

    return mapQueryResult({
      columns: result.data.columns,
      rows: result.data.rows,
      rowCount: result.data.rowCount,
    });
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
    const snapshot = await this.buildSnapshot(await this.ensureTinyCloud());
    const nextSpace = snapshot.spaces.find((candidate) => candidate.id === spaceId);
    const updated = nextSpace?.resources.find(
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
    const result = await this.kvServiceForSpace(tcw, spaceId).put(fullKey, value);
    if (!result.ok) {
      throw explorerError(
        classifyExplorerFailure(result.error),
        result.error.message,
        result.error,
      );
    }

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
    const result = await this.kvServiceForSpace(tcw, spaceId).delete(fullKey);
    if (!result.ok) {
      throw explorerError(
        classifyExplorerFailure(result.error),
        result.error.message,
        result.error,
      );
    }

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
            owner: tcw.session()?.address ?? spaceId,
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
    const specialSpaceRoot = resourceId === "__space__";
    if (specialSpaceRoot) {
      const configuredPrefix = (this.config.kvPrefix ?? "explorer")
        .trim()
        .replace(/^\/+|\/+$/g, "");
      const permissionPath = configuredPrefix ? `${configuredPrefix}/` : "/";
      const response = await tcw.requestPermissions([
        {
          service: "tinycloud.kv",
          space: spaceId,
          path: permissionPath,
          actions: ["tinycloud.kv/get", "tinycloud.kv/list", "tinycloud.kv/put"],
        },
      ]);
      if (!response.approved) {
        throw explorerError("denied-capability", "OpenKey denied the access request.");
      }
      return emptyKvResource(
        spaceId,
        space ?? {
          id: spaceId,
          name: this.preferredSpaceName() ?? spaceId,
          uri: spaceId,
          owner: tcw.session()?.address ?? spaceId,
          resourceCount: 0,
          access: "read-write",
          resources: [],
          evidence: [],
        },
        this.preferredSpaceName() ?? topLevelPrefix(spaceId),
      );
    }
    if (!resource) {
      throw explorerError("unsupported-resource", "The selected resource is no longer available.");
    }

    const permissions = this.permissionEntriesFor(resource, spaceId);
    if (permissions.length === 0) {
      throw explorerError("unsupported-resource", "This resource does not support access escalation.");
    }

    const response = await tcw.requestPermissions(permissions);
    if (!response.approved) {
      throw explorerError("denied-capability", "OpenKey denied the access request.");
    }

    const nextSnapshot = await this.buildSnapshot(tcw);
    const nextSpace = nextSnapshot.spaces.find((candidate) => candidate.id === spaceId);
    const updated = nextSpace?.resources.find((candidate) => candidate.id === resourceId);
    if (!updated) {
      throw explorerError("unsupported-resource", "The resource disappeared after approval.");
    }
    return updated;
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
      path: resource.path,
      actions: resource.access === "read-write"
        ? ["tinycloud.kv/put"]
        : ["tinycloud.kv/get"],
    }];
  }
}
