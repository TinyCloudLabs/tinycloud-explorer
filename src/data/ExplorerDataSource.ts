export type ExplorerLevel = "system" | "space" | "resource";
export type ResourceKind = "sql" | "kv";
export type AccessMode = "read-only" | "read-write" | "needs-permission";
export type ExplorerMode = "real" | "mock";
export type DiscoveryPhase = "spaces" | "resources" | "ready";
export type SpaceDiscoveryState = "loading" | "ready";

export interface ResourcePermissions {
  list: boolean;
  describe: boolean;
  read: boolean;
  write: boolean;
  query: boolean;
  grant: boolean;
}

export interface ExplorerIdentity {
  address: string;
  did: string;
  sessionDid: string;
  nodeUrl: string;
}

export interface CapabilityStep {
  id: string;
  label: string;
  detail: string;
  timestamp: string;
  verified: boolean;
}

export interface SqlColumn {
  name: string;
  type: string;
}

export type SqlCell = string | number | boolean | null;

export interface SqlTable {
  name: string;
  rowCount: number;
  columns: SqlColumn[];
  rows: Record<string, SqlCell>[];
  concealed?: boolean;
  loaded?: boolean;
}

export interface KvEntry {
  key: string;
  value: unknown;
  contentType: string;
  size: number | null;
  updatedAt: string | null;
  cid: string;
  encrypted: boolean | null;
  hidden?: boolean;
}

interface ResourceBase {
  id: string;
  name: string;
  path: string;
  kind: ResourceKind;
  access: AccessMode;
  owner: string;
  grantedBy: string | null;
  expiresAt: string | null;
  size: number | null;
  updatedAt: string | null;
  permissions: ResourcePermissions;
  evidence: CapabilityStep[];
}

export interface SqlResource extends ResourceBase {
  kind: "sql";
  tables: SqlTable[];
  cannedQueries: {
    id: string;
    label: string;
    sql: string;
  }[];
}

export interface KvResource extends ResourceBase {
  kind: "kv";
  entries: KvEntry[];
}

export type TinyCloudResource = SqlResource | KvResource;

export interface TinyCloudSpace {
  id: string;
  name: string;
  uri: string;
  owner: string;
  resourceCount: number;
  access: AccessMode;
  discoveryState?: SpaceDiscoveryState;
  resources: TinyCloudResource[];
  evidence: CapabilityStep[];
}

export interface SqlQueryResult {
  columns: SqlColumn[];
  rows: Record<string, SqlCell>[];
  elapsedMs: number;
}

export interface ExplorerSnapshot {
  identity: ExplorerIdentity;
  spaces: TinyCloudSpace[];
  evidence: CapabilityStep[];
  discovery?: {
    phase: DiscoveryPhase;
    completedSpaces: number;
    totalSpaces: number;
  };
}

export type ExplorerSnapshotListener = (snapshot: ExplorerSnapshot) => void;

export interface ExplorerDataSource {
  readonly mode: ExplorerMode;
  connect(onSnapshot?: ExplorerSnapshotListener): Promise<ExplorerSnapshot>;
  disconnect(): Promise<void>;
  listSpaces(): Promise<TinyCloudSpace[]>;
  runQuery(
    spaceId: string,
    resourceId: string,
    sql: string,
  ): Promise<SqlQueryResult>;
  writeKvEntry(
    spaceId: string,
    resourceId: string,
    key: string,
    value: unknown,
  ): Promise<KvResource>;
  deleteKvEntry(
    spaceId: string,
    resourceId: string,
    key: string,
  ): Promise<KvResource>;
  grantPermission(
    spaceId: string,
    resourceId: string,
  ): Promise<TinyCloudResource>;
  grantSpacePermissions(spaceId: string): Promise<TinyCloudSpace>;
}
