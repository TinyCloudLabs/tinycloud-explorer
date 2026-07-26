export type ExplorerLevel = "system" | "space" | "resource";
export type ResourceKind = "sql" | "kv";
export type AccessMode = "read-only" | "read-write";

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
}

export interface KvEntry {
  key: string;
  value: unknown;
  contentType: string;
  size: number;
  updatedAt: string;
  cid: string;
  encrypted: boolean;
}

interface ResourceBase {
  id: string;
  name: string;
  path: string;
  kind: ResourceKind;
  access: AccessMode;
  owner: string;
  grantedBy: string;
  expiresAt: string;
  size: number;
  updatedAt: string;
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
}

export interface ExplorerDataSource {
  connect(): Promise<ExplorerSnapshot>;
  disconnect(): Promise<void>;
  listSpaces(): Promise<TinyCloudSpace[]>;
  runQuery(
    spaceId: string,
    resourceId: string,
    sql: string,
  ): Promise<SqlQueryResult>;
}
