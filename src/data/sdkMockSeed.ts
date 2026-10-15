import type {
  AccessMode,
  CapabilityStep,
  ExplorerIdentity,
  KvResource,
  ResourcePermissions,
  SqlResource,
  TinyCloudResource,
  TinyCloudSpace,
} from "./ExplorerDataSource";

export const sdkMockIdentity: ExplorerIdentity = {
  address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  did: "did:pkh:eip155:1:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  sessionDid: "did:key:z6Mki3df9ad6e41f7aB2",
  nodeUrl: "https://node.tinycloud.xyz",
};

export const sdkMockSystemEvidence: CapabilityStep[] = [
  {
    id: "session",
    label: "Session established",
    detail: "session: 9d3f…a7b2",
    timestamp: "2026-07-26T13:42:10Z",
    verified: true,
  },
  {
    id: "delegation",
    label: "Delegation verified",
    detail: "delegation: d_01HZX3Q7W8Y0",
    timestamp: "2026-07-26T13:42:11Z",
    verified: true,
  },
  {
    id: "space",
    label: "Space access granted",
    detail: "4 spaces visible",
    timestamp: "2026-07-26T13:42:12Z",
    verified: true,
  },
  {
    id: "resource",
    label: "Resources indexed",
    detail: "14 resources listed",
    timestamp: "2026-07-26T13:42:13Z",
    verified: true,
  },
];

function evidenceFor(space: string, resource?: string): CapabilityStep[] {
  return sdkMockSystemEvidence.map((step) => {
    if (step.id === "space") {
      return { ...step, detail: `space: tinycloud:…:${space}` };
    }
    if (step.id === "resource" && resource) {
      return {
        ...step,
        label: "Resource access confirmed",
        detail: `resource: ${resource}`,
      };
    }
    return step;
  });
}

function permissionsFor(
  access: AccessMode,
  kind: "sql" | "kv",
): ResourcePermissions {
  const readable = access !== "needs-permission";
  return {
    list: true,
    describe: true,
    read: readable,
    write: access === "read-write",
    query: readable && kind === "sql",
    grant: access === "needs-permission",
  };
}

const conversations: SqlResource = {
  id: "listen-conversations",
  name: "conversations",
  path: "tinycloud:pkh:eip155:1:0xf39F…2266:listen/sql/conversations",
  kind: "sql",
  access: "read-write",
  owner: sdkMockIdentity.did,
  grantedBy: "did:key:z6MkvQ93…r8s",
  expiresAt: "2026-08-14T00:00:00Z",
  size: 24_800_000,
  updatedAt: "2026-07-26T12:39:14Z",
  permissions: permissionsFor("read-write", "sql"),
  evidence: evidenceFor("listen", "sql/conversations"),
  cannedQueries: [
    {
      id: "recent",
      label: "Recent conversations",
      sql: "SELECT id, title, created_at, owner FROM conversations ORDER BY created_at DESC LIMIT 25;",
    },
    {
      id: "by-source",
      label: "Count by source",
      sql: "SELECT source, COUNT(*) AS total FROM conversations GROUP BY source ORDER BY total DESC;",
    },
  ],
  tables: [
    {
      name: "conversations",
      rowCount: 128_450,
      columns: [
        { name: "id", type: "TEXT" },
        { name: "title", type: "TEXT" },
        { name: "source", type: "TEXT" },
        { name: "created_at", type: "TIMESTAMP" },
        { name: "owner", type: "TEXT" },
      ],
      rows: [
        {
          id: "c_01HZX3Q7W8Y1",
          title: "Project kickoff",
          source: "microphone",
          created_at: "2026-07-26 09:14:22",
          owner: "u_01F8K3A9N2",
        },
        {
          id: "c_01HZX3Q7W8Y2",
          title: "Design sync",
          source: "upload",
          created_at: "2026-07-26 10:03:11",
          owner: "u_01F8K3A9N2",
        },
        {
          id: "c_01HZX3Q7W8Y3",
          title: "Infrastructure review",
          source: "microphone",
          created_at: "2026-07-26 11:47:05",
          owner: "u_01F8K3A9N2",
        },
        {
          id: "c_01HZX3Q7W8Y4",
          title: "Partner follow-up",
          source: "calendar",
          created_at: "2026-07-26 12:18:44",
          owner: "u_02T9B4M7P5",
        },
        {
          id: "c_01HZX3Q7W8Y5",
          title: "Release retrospective",
          source: "upload",
          created_at: "2026-07-26 12:39:14",
          owner: "u_01F8K3A9N2",
        },
      ],
    },
    {
      name: "utterances",
      rowCount: 3_982_114,
      columns: [
        { name: "id", type: "TEXT" },
        { name: "conversation_id", type: "TEXT" },
        { name: "speaker_id", type: "TEXT" },
        { name: "body", type: "TEXT" },
      ],
      rows: [
        {
          id: "utt_001",
          conversation_id: "c_01HZX3Q7W8Y3",
          speaker_id: "spk_sam",
          body: "The capability chain should remain visible.",
        },
        {
          id: "utt_002",
          conversation_id: "c_01HZX3Q7W8Y3",
          speaker_id: "spk_mira",
          body: "Agreed. Make the evidence part of the workspace.",
        },
      ],
    },
    {
      name: "speakers",
      rowCount: 46,
      columns: [
        { name: "id", type: "TEXT" },
        { name: "display_name", type: "TEXT" },
        { name: "sample_count", type: "INTEGER" },
      ],
      rows: [
        { id: "spk_sam", display_name: "Sam", sample_count: 324 },
        { id: "spk_mira", display_name: "Mira", sample_count: 117 },
      ],
    },
  ],
};

const audioChunks: KvResource = {
  id: "listen-audio-chunks",
  name: "audio/chunks",
  path: "tinycloud:pkh:eip155:1:0xf39F…2266:listen/kv/audio/chunks",
  kind: "kv",
  access: "read-write",
  owner: sdkMockIdentity.did,
  grantedBy: null,
  expiresAt: null,
  size: null,
  updatedAt: null,
  permissions: permissionsFor("read-write", "kv"),
  evidence: evidenceFor("listen", "kv/audio/chunks"),
  entries: [
    {
      key: "audio/chunks/c_01HZX3Q7W8Y3/manifest.json",
      value: {
        conversationId: "c_01HZX3Q7W8Y3",
        chunks: 18,
        codec: "opus",
        sampleRate: 48_000,
        durationSeconds: 2_484,
      },
      contentType: "application/json",
      size: null,
      updatedAt: null,
      cid: "bafybeig7jgm7…kc2q",
      encrypted: null,
    },
    {
      key: "audio/chunks/c_01HZX3Q7W8Y3/0001.opus",
      value: "Binary audio data · preview unavailable in wireframe",
      contentType: "audio/ogg; codecs=opus",
      size: 482_304,
      updatedAt: "2026-07-26T11:07:12Z",
      cid: "bafybeih3e4vq…9r2m",
      encrypted: null,
    },
    {
      key: "audio/chunks/c_01HZX3Q7W8Y3/0002.opus",
      value: "Binary audio data · preview unavailable in wireframe",
      contentType: "audio/ogg; codecs=opus",
      size: 501_771,
      updatedAt: "2026-07-26T11:09:48Z",
      cid: "bafybeib9hz3a…4f7c",
      encrypted: null,
    },
  ],
};

const speakerProfiles: KvResource = {
  id: "listen-speaker-profiles",
  name: "speaker-profiles",
  path: "tinycloud:pkh:eip155:1:0xf39F…2266:listen/kv/speaker-profiles",
  kind: "kv",
  access: "read-only",
  owner: sdkMockIdentity.did,
  grantedBy: "did:key:z6MkvQ93…r8s",
  expiresAt: "2026-08-14T00:00:00Z",
  size: 56_410,
  updatedAt: "2026-07-26T09:24:31Z",
  permissions: permissionsFor("read-only", "kv"),
  evidence: evidenceFor("listen", "kv/speaker-profiles"),
  entries: [
    {
      key: "speaker-profiles/spk_sam",
      value: {
        displayName: "Sam",
        aliases: ["Sam G.", "Speaker 1"],
        confidence: 0.982,
        samples: 324,
      },
      contentType: "application/json",
      size: 186,
      updatedAt: "2026-07-26T09:24:31Z",
      cid: "bafybeigvwm4d…0aa2",
      encrypted: null,
    },
    {
      key: "speaker-profiles/spk_mira",
      value: {
        displayName: "Mira",
        aliases: ["Speaker 2"],
        confidence: 0.947,
        samples: 117,
      },
      contentType: "application/json",
      size: 164,
      updatedAt: "2026-07-25T18:02:11Z",
      cid: "bafybeifp23jd…13ac",
      encrypted: null,
    },
  ],
};

function genericSql(
  id: string,
  name: string,
  space: string,
  rows: number,
  access: AccessMode = "read-only",
): SqlResource {
  return {
    ...conversations,
    id,
    name,
    path: `tinycloud:pkh:eip155:1:0xf39F…2266:${space}/sql/${name}`,
    size: rows * 172,
    access,
    permissions: permissionsFor(access, "sql"),
    evidence: evidenceFor(space, `sql/${name}`),
    tables: [
      {
        ...conversations.tables[0],
        name,
        rowCount: rows,
      },
    ],
  };
}

function genericKv(
  id: string,
  name: string,
  space: string,
  access: AccessMode = "read-only",
): KvResource {
  return {
    ...speakerProfiles,
    id,
    name,
    path: `tinycloud:pkh:eip155:1:0xf39F…2266:${space}/kv/${name}`,
    access,
    permissions: permissionsFor(access, "kv"),
    evidence: evidenceFor(space, `kv/${name}`),
    entries: speakerProfiles.entries.map((entry, index) => ({
      ...entry,
      key: `${name}/record-${index + 1}`,
    })),
  };
}

const auditLog = genericSql(
  "listen-audit-log",
  "audit-log",
  "listen",
  18_204,
  "needs-permission",
);

const preferences = genericKv(
  "listen-preferences",
  "preferences",
  "listen",
  "needs-permission",
);

export const sdkMockSpaces: TinyCloudSpace[] = [
  {
    id: "applications",
    name: "applications",
    uri: "tinycloud:pkh:eip155:1:0xf39F…2266:applications",
    owner: sdkMockIdentity.did,
    resourceCount: 3,
    access: "read-write",
    evidence: evidenceFor("applications"),
    resources: [
      genericSql(
        "applications-registry",
        "app_registry",
        "applications",
        24,
        "read-write",
      ),
      genericKv(
        "applications-manifests",
        "manifests",
        "applications",
        "read-write",
      ),
      genericKv(
        "applications-preferences",
        "preferences",
        "applications",
        "read-write",
      ),
    ],
  },
  {
    id: "listen",
    name: "listen",
    uri: "tinycloud:pkh:eip155:1:0xf39F…2266:listen",
    owner: sdkMockIdentity.did,
    resourceCount: 5,
    access: "read-only",
    evidence: evidenceFor("listen"),
    resources: [
      conversations,
      audioChunks,
      speakerProfiles,
      auditLog,
      preferences,
    ],
  },
  {
    id: "credentials",
    name: "credentials",
    uri: "tinycloud:pkh:eip155:1:0xf39F…2266:credentials",
    owner: sdkMockIdentity.did,
    resourceCount: 3,
    access: "read-only",
    evidence: evidenceFor("credentials"),
    resources: [
      genericSql(
        "credentials-issued",
        "issued_credentials",
        "credentials",
        1_842,
      ),
      genericKv("credentials-schemas", "schemas", "credentials"),
      genericKv("credentials-revocations", "revocations", "credentials"),
    ],
  },
  {
    id: "account",
    name: "account",
    uri: "tinycloud:pkh:eip155:1:0xf39F…2266:account",
    owner: sdkMockIdentity.did,
    resourceCount: 3,
    access: "read-write",
    evidence: evidenceFor("account"),
    resources: [
      genericSql(
        "account-index",
        "account_index",
        "account",
        38,
        "read-write",
      ),
      genericKv("account-profile", "profile", "account", "read-write"),
      genericKv(
        "account-delegations",
        "delegations",
        "account",
        "read-write",
      ),
    ],
  },
  {
    id: "archive",
    name: "archive",
    uri: "tinycloud:pkh:eip155:1:0xf39F…2266:archive",
    owner: sdkMockIdentity.did,
    resourceCount: 0,
    access: "needs-permission",
    evidence: evidenceFor("archive"),
    resources: [],
  },
];

export const sdkMockSeed: Record<string, unknown> = {
  "explorer/identity": sdkMockIdentity,
  "explorer/evidence": sdkMockSystemEvidence,
  "explorer/space-order": sdkMockSpaces.map((space) => space.id),
};

for (const space of sdkMockSpaces) {
  const { resources, ...spaceDescriptor } = space;
  sdkMockSeed[`spaces/${space.id}`] = spaceDescriptor;
  for (const resource of resources) {
    sdkMockSeed[`resources/${space.id}/${resource.id}`] = resource;
  }
}
