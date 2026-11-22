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
  rowCount: number | null;
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

/** Events One pushes while Explorer is framed (embedded mode only). */
export interface ExplorerEmbedListener {
  onTheme(theme: "light" | "dark"): void;
  /** One revoked the delegation: drop to the signed-out state. */
  onRevoked(): void;
}

export interface ExplorerDataSource {
  /** Present only when Explorer runs inside TinyCloud One. */
  readonly embed?: {
    subscribe(listener: ExplorerEmbedListener): () => void;
  };
  readonly mode: ExplorerMode;
  connect(onSnapshot?: ExplorerSnapshotListener): Promise<ExplorerSnapshot>;
  /**
   * Standalone real mode: bring back a saved session without opening OpenKey. Resolves null when there is none to
   * bring back. Absent where nothing is saved between loads.
   */
  restore?(onSnapshot?: ExplorerSnapshotListener): Promise<ExplorerSnapshot | null>;
  /**
   * Signs the person out. `onSignedOut` runs as soon as Explorer's own session is cleared.
   */
  disconnect(onSignedOut?: () => void): Promise<void>;
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
