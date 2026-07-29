import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { TinyCloudNode } from "@tinycloud/node-sdk";
import { buildSpaceUri } from "@tinycloud/sdk-core";
import {
  REAL_FIXTURE_ACCOUNT_SPACE,
  REAL_FIXTURE_ACCOUNT_SQL_DATABASE,
  REAL_FIXTURE_ADDRESS,
  REAL_FIXTURE_APPLICATIONS_SPACE,
  REAL_FIXTURE_CHAIN_ID,
  REAL_FIXTURE_DEFAULT_SQL_DATABASE,
  REAL_FIXTURE_DID,
  REAL_FIXTURE_EXPLORER_APP_ID,
  REAL_FIXTURE_HOST,
  REAL_FIXTURE_KV_CANARY,
  REAL_FIXTURE_PRIVATE_KEY,
  REAL_FIXTURE_PUBLIC_SPACE,
  REAL_FIXTURE_SECRETS_NETWORK,
  REAL_FIXTURE_SECRETS_SPACE,
  REAL_FIXTURE_SECRET_NAMES,
  REAL_FIXTURE_SQL_CANARY,
  REAL_FIXTURE_VARIABLE_NAMES,
  realFixtureSecretValue,
  realFixtureVariableValue,
} from "../src/data/realFixture";

type SeedState = {
  version: 1;
  host: string;
  chainId: number;
  address: string;
  did: string;
  nodeSdkVersion: string;
  cliVersion: string;
  runSeed: string;
  secretHashes: Record<string, string>;
};

type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  json: unknown;
};

const DEFAULT_STATE_FILE = ".context/tinycloud-explorer-real-fixture.json";
const EXPECTED_NODE_SDK_VERSION = "2.10.0-beta.0";
const JS_SDK_FIXTURE_WORKTREE = resolve(tmpdir(), "tinycloud-js-sdk-cli-fixture");
const REAL_FIXTURE_CLI_PROFILE = "fixture";
let preparedCliWorkspace: Promise<string> | undefined;
let preparedCliHome: string | undefined;
let preparedCliHost: string | undefined;
const TRACE_FIXTURE = process.env.REAL_FIXTURE_TRACE === "1";

function workspaceRootFrom(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 12; i += 1) {
    const candidate = resolve(current, "repositories/js-sdk/package.json");
    if (existsSync(candidate)) return current;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Unable to locate the workspace root.");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function trace(message: string): void {
  if (TRACE_FIXTURE) {
    console.error(`[real-fixture] ${message}`);
  }
}

function ensureOk(result: { ok: boolean; error?: { message: string } }, label: string): void {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error?.message ?? "unknown error"}`);
  }
}

function dbQuery(
  table: string,
  rows: Array<Record<string, string | number>>,
  options: { reset?: boolean } = {},
): string[] {
  const columns = Object.keys(rows[0] ?? {});
  if (columns.length === 0) {
    throw new Error(`No rows provided for ${table}`);
  }
  const nonIdColumns = columns.filter((column) => column !== "id");
  const defs = nonIdColumns.map((column) => `${column} TEXT NOT NULL`).join(", ");
  const insertColumns = columns.join(", ");
  const values = rows
    .map((row) => `(${columns.map((column) => JSON.stringify(String(row[column] ?? ""))).join(", ")})`)
    .join(",\n");
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `${column}=excluded.${column}`)
    .join(", ");
  const statements = [
    `
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY${defs ? `,\n        ${defs}` : ""}
      )
    `,
  ];
  if (options.reset) {
    statements.push(`
      DROP TABLE IF EXISTS ${table}
    `);
    statements.push(`
      CREATE TABLE ${table} (
        id TEXT PRIMARY KEY${defs ? `,\n        ${defs}` : ""}
      )
    `);
  }
  statements.push(`
    INSERT INTO ${table} (${insertColumns})
    VALUES
      ${values}
    ON CONFLICT(id) DO UPDATE SET ${updates || "id=excluded.id"}
  `);
  return statements;
}

async function loadState(stateFile: string): Promise<SeedState> {
  const parsed = JSON.parse(await readFile(stateFile, "utf8")) as SeedState;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported fixture state version: ${(parsed as { version?: unknown }).version}`);
  }
  return parsed;
}

async function saveState(stateFile: string, state: SeedState): Promise<void> {
  await mkdir(resolve(stateFile, ".."), { recursive: true });
  await writeFile(stateFile, `${pretty(state)}\n`, "utf8");
}

async function runTinyCloudCli(
  cliDir: string,
  host: string,
  args: string[],
  input?: string,
): Promise<CliResult> {
  const cliEntry = resolve(cliDir, "bin/tc");
  if (preparedCliHome === undefined) {
    throw new Error("CLI home was not prepared.");
  }
  const proc = Bun.spawn(
    ["bun", cliEntry, "--host", host, "--json", "--quiet", "--profile", REAL_FIXTURE_CLI_PROFILE, ...args],
    {
      cwd: cliDir,
      stdin: input === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        TC_HOME: preparedCliHome,
      },
    },
  );

  if (input !== undefined) {
    proc.stdin.write(input);
    proc.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  let json: unknown = null;
  try {
    json = JSON.parse(stdout.trim());
  } catch {
    json = null;
  }
  return { stdout: stdout.trim(), stderr, exitCode, json };
}

async function runCommand(
  command: string[],
  cwd: string,
  label: string,
): Promise<void> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${label} failed (exit ${exitCode}): ${stderr || stdout || "no output"}`,
    );
  }
}

async function prepareCliWorkspace(workspaceRoot: string): Promise<string> {
  if (preparedCliWorkspace !== undefined) {
    return preparedCliWorkspace;
  }

  preparedCliWorkspace = (async () => {
    const sourceRepo = resolve(workspaceRoot, "repositories/js-sdk");
    const sourceCommitProc = Bun.spawn(
      ["git", "-C", sourceRepo, "rev-parse", "HEAD"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [sourceCommit, sourceCommitErr, sourceCommitExit] = await Promise.all([
      new Response(sourceCommitProc.stdout).text(),
      new Response(sourceCommitProc.stderr).text(),
      sourceCommitProc.exited,
    ]);
    if (sourceCommitExit !== 0) {
      throw new Error(`Unable to read js-sdk HEAD: ${sourceCommitErr || sourceCommit}`);
    }
    const commit = sourceCommit.trim();
    const markerFile = resolve(JS_SDK_FIXTURE_WORKTREE, ".codex-fixture-commit");
    const marker = existsSync(markerFile) ? (await readFile(markerFile, "utf8")).trim() : "";
    const cliDist = resolve(JS_SDK_FIXTURE_WORKTREE, "packages/cli/dist/index.js");
    const cliHome = resolve(JS_SDK_FIXTURE_WORKTREE, "home");
    const cliProfile = resolve(cliHome, ".tinycloud/profiles", REAL_FIXTURE_CLI_PROFILE, "profile.json");
    if (marker === commit && existsSync(cliDist) && existsSync(cliProfile)) {
      preparedCliHome = cliHome;
      return resolve(JS_SDK_FIXTURE_WORKTREE, "packages/cli");
    }

    const sourceCliDir = `${sourceRepo}/packages/cli/.`;
    const sourceSdkCoreDir = `${sourceRepo}/packages/sdk-core/.`;
    await runCommand(["rm", "-rf", JS_SDK_FIXTURE_WORKTREE], workspaceRoot, "clean js-sdk fixture workspace");
    await runCommand(["mkdir", "-p", resolve(JS_SDK_FIXTURE_WORKTREE, "packages")], workspaceRoot, "create js-sdk fixture workspace");
    await runCommand(
      ["cp", "-R", sourceCliDir, resolve(JS_SDK_FIXTURE_WORKTREE, "packages/cli")],
      workspaceRoot,
      "copy js-sdk cli package",
    );
    await runCommand(
      ["cp", "-R", sourceSdkCoreDir, resolve(JS_SDK_FIXTURE_WORKTREE, "packages/sdk-core")],
      workspaceRoot,
      "copy js-sdk sdk-core package",
    );
    await runCommand(
      ["bun", "install"],
      resolve(JS_SDK_FIXTURE_WORKTREE, "packages/cli"),
      "bun install in js-sdk cli fixture",
    );
    await runCommand(
      ["ln", "-sfn", resolve(JS_SDK_FIXTURE_WORKTREE, "packages/cli/node_modules"), resolve(JS_SDK_FIXTURE_WORKTREE, "packages/node_modules")],
      workspaceRoot,
      "link shared node_modules for copied sdk-core",
    );
    await runCommand(["bun", "run", "build"], resolve(JS_SDK_FIXTURE_WORKTREE, "packages/cli"), "build js-sdk cli fixture");
    preparedCliHome = cliHome;
    await runCommand(["rm", "-rf", cliHome], workspaceRoot, "clean js-sdk cli home");
    await writeFile(markerFile, `${commit}\n`, "utf8");
    return resolve(JS_SDK_FIXTURE_WORKTREE, "packages/cli");
  })();

  return preparedCliWorkspace;
}

async function ensureCliProfile(cliDir: string, host: string): Promise<void> {
  if (!preparedCliHome) {
    throw new Error("CLI home was not prepared.");
  }

  const profileDir = resolve(
    preparedCliHome,
    ".tinycloud/profiles",
    REAL_FIXTURE_CLI_PROFILE,
  );
  const profilePath = resolve(profileDir, "profile.json");
  const sessionPath = resolve(profileDir, "session.json");
  if (
    preparedCliHost === host &&
    existsSync(profilePath) &&
    existsSync(sessionPath)
  ) {
    return;
  }

  await mkdir(profileDir, { recursive: true });
  await writeFile(
    profilePath,
    `${pretty({
      name: REAL_FIXTURE_CLI_PROFILE,
      host,
      chainId: REAL_FIXTURE_CHAIN_ID,
      spaceName: "default",
      spaceId: `tinycloud:pkh:eip155:1:${REAL_FIXTURE_ADDRESS}:default`,
      did: REAL_FIXTURE_DID,
      ownerDid: REAL_FIXTURE_DID,
      posture: "local-owner-key",
      operatorType: "human",
      authMethod: "local",
      privateKey: REAL_FIXTURE_PRIVATE_KEY,
      address: REAL_FIXTURE_ADDRESS,
      createdAt: new Date().toISOString(),
    })}\n`,
    "utf8",
  );
  await runTinyCloudCli(cliDir, host, ["auth", "login", "--method", "local"]);
  preparedCliHost = host;
}

async function createFixtureNode(host: string): Promise<TinyCloudNode> {
  const publicSpaceId = buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_PUBLIC_SPACE);
  const applicationsSpaceId = buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_APPLICATIONS_SPACE);
  const accountSpaceId = buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_ACCOUNT_SPACE);
  const secretsSpaceId = buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_SECRETS_SPACE);
  const node = new TinyCloudNode({
    privateKey: REAL_FIXTURE_PRIVATE_KEY,
    host,
    prefix: "tinycloud-explorer-real-fixture",
    autoCreateSpace: true,
    manifest: {
      app_id: REAL_FIXTURE_EXPLORER_APP_ID,
      name: "TinyCloud Explorer fixture seeder",
      defaults: false,
      includePublicSpace: true,
      permissions: [
        {
          service: "tinycloud.kv",
          space: publicSpaceId,
          path: "",
          actions: [
            "tinycloud.kv/get",
            "tinycloud.kv/put",
            "tinycloud.kv/del",
            "tinycloud.kv/list",
            "tinycloud.kv/metadata",
          ],
          skipPrefix: true,
        },
        {
          service: "tinycloud.sql",
          space: publicSpaceId,
          path: REAL_FIXTURE_DEFAULT_SQL_DATABASE,
          actions: [
            "tinycloud.sql/read",
            "tinycloud.sql/write",
            "tinycloud.sql/schema",
            "tinycloud.sql/admin",
          ],
          skipPrefix: true,
        },
        {
          service: "tinycloud.kv",
          space: applicationsSpaceId,
          path: "",
          actions: [
            "tinycloud.kv/get",
            "tinycloud.kv/put",
            "tinycloud.kv/del",
            "tinycloud.kv/list",
            "tinycloud.kv/metadata",
          ],
          skipPrefix: true,
        },
        {
          service: "tinycloud.sql",
          space: applicationsSpaceId,
          path: REAL_FIXTURE_DEFAULT_SQL_DATABASE,
          actions: [
            "tinycloud.sql/read",
            "tinycloud.sql/write",
            "tinycloud.sql/schema",
            "tinycloud.sql/admin",
          ],
          skipPrefix: true,
        },
        {
          service: "tinycloud.kv",
          space: accountSpaceId,
          path: "",
          actions: [
            "tinycloud.kv/get",
            "tinycloud.kv/put",
            "tinycloud.kv/del",
            "tinycloud.kv/list",
            "tinycloud.kv/metadata",
          ],
          skipPrefix: true,
        },
        {
          service: "tinycloud.kv",
          space: accountSpaceId,
          path: "spaces/",
          actions: [
            "tinycloud.kv/get",
            "tinycloud.kv/del",
            "tinycloud.kv/list",
            "tinycloud.kv/metadata",
          ],
          skipPrefix: true,
        },
        {
          service: "tinycloud.kv",
          space: accountSpaceId,
          path: "delegations/",
          actions: [
            "tinycloud.kv/get",
            "tinycloud.kv/put",
            "tinycloud.kv/del",
            "tinycloud.kv/list",
            "tinycloud.kv/metadata",
          ],
          skipPrefix: true,
        },
        {
          service: "tinycloud.sql",
          space: accountSpaceId,
          path: REAL_FIXTURE_ACCOUNT_SQL_DATABASE,
          actions: [
            "tinycloud.sql/read",
            "tinycloud.sql/write",
            "tinycloud.sql/schema",
            "tinycloud.sql/admin",
          ],
          skipPrefix: true,
        },
        {
          service: "tinycloud.sql",
          space: secretsSpaceId,
          path: REAL_FIXTURE_DEFAULT_SQL_DATABASE,
          actions: [
            "tinycloud.sql/read",
            "tinycloud.sql/write",
            "tinycloud.sql/schema",
            "tinycloud.sql/admin",
          ],
          skipPrefix: true,
        },
        {
          service: "tinycloud.kv",
          space: secretsSpaceId,
          path: "vault/secrets/",
          actions: [
            "tinycloud.kv/get",
            "tinycloud.kv/del",
            "tinycloud.kv/list",
            "tinycloud.kv/metadata",
          ],
          skipPrefix: true,
        },
        {
          service: "tinycloud.kv",
          space: secretsSpaceId,
          path: "variables/",
          actions: [
            "tinycloud.kv/get",
            "tinycloud.kv/put",
            "tinycloud.kv/del",
            "tinycloud.kv/list",
            "tinycloud.kv/metadata",
          ],
          skipPrefix: true,
        },
      ],
    },
  });
  await node.signIn();
  return node;
}

async function ensureHostedSpaces(node: TinyCloudNode): Promise<Record<string, string>> {
  const publicSpaceId = await node.ensureOwnedSpaceHosted(REAL_FIXTURE_PUBLIC_SPACE);
  const applicationsSpaceId = await node.ensureOwnedSpaceHosted(REAL_FIXTURE_APPLICATIONS_SPACE);
  const accountSpaceId = await node.ensureOwnedSpaceHosted(REAL_FIXTURE_ACCOUNT_SPACE);
  const secretsSpaceId = await node.ensureOwnedSpaceHosted(REAL_FIXTURE_SECRETS_SPACE);

  const required = new Map<string, string>([
    [REAL_FIXTURE_PUBLIC_SPACE, publicSpaceId],
    [REAL_FIXTURE_APPLICATIONS_SPACE, applicationsSpaceId],
    [REAL_FIXTURE_ACCOUNT_SPACE, accountSpaceId],
    [REAL_FIXTURE_SECRETS_SPACE, secretsSpaceId],
  ]);
  return Object.fromEntries(required);
}

async function verifyHostedSpaces(node: TinyCloudNode): Promise<Record<string, string>> {
  const names = [
    REAL_FIXTURE_PUBLIC_SPACE,
    REAL_FIXTURE_APPLICATIONS_SPACE,
    REAL_FIXTURE_ACCOUNT_SPACE,
    REAL_FIXTURE_SECRETS_SPACE,
  ];
  const result: Record<string, string> = {};

  const spacesResult = await node.account.index.spaces.list();
  ensureOk(spacesResult, "Hosted-space listing");
  const spaces = spacesResult.data;

  for (const name of names) {
    const spaceId = buildSpaceUri(REAL_FIXTURE_DID, name);
    const record = spaces.find((space) =>
      space.name === name ||
      space.spaceId === spaceId ||
      space.spaceId.endsWith(`:${name}`)
    );
    if (!record) {
      throw new Error(`Hosted-space registry missing ${name} (${spaceId}).`);
    }
    if (
      record.ownerDid !== REAL_FIXTURE_DID &&
      record.ownerDid !== REAL_FIXTURE_DID.toLowerCase()
    ) {
      throw new Error(`Hosted-space owner mismatch for ${name} (${spaceId}).`);
    }
    result[name] = spaceId;
  }

  return result;
}

async function grantSeedRuntimePermissions(node: TinyCloudNode): Promise<void> {
  const grants = [
    {
      service: "tinycloud.sql",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_PUBLIC_SPACE),
      path: REAL_FIXTURE_DEFAULT_SQL_DATABASE,
      actions: [
        "tinycloud.sql/read",
        "tinycloud.sql/write",
        "tinycloud.sql/schema",
        "tinycloud.sql/admin",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_PUBLIC_SPACE),
      path: "",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/put",
        "tinycloud.kv/del",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.sql",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_APPLICATIONS_SPACE),
      path: REAL_FIXTURE_DEFAULT_SQL_DATABASE,
      actions: [
        "tinycloud.sql/read",
        "tinycloud.sql/write",
        "tinycloud.sql/schema",
        "tinycloud.sql/admin",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_APPLICATIONS_SPACE),
      path: "",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/put",
        "tinycloud.kv/del",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.sql",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_ACCOUNT_SPACE),
      path: REAL_FIXTURE_ACCOUNT_SQL_DATABASE,
      actions: [
        "tinycloud.sql/read",
        "tinycloud.sql/write",
        "tinycloud.sql/schema",
        "tinycloud.sql/admin",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_ACCOUNT_SPACE),
      path: "",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/put",
        "tinycloud.kv/del",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_ACCOUNT_SPACE),
      path: "spaces/",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/del",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_ACCOUNT_SPACE),
      path: "delegations/",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/put",
        "tinycloud.kv/del",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.sql",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_SECRETS_SPACE),
      path: REAL_FIXTURE_DEFAULT_SQL_DATABASE,
      actions: [
        "tinycloud.sql/read",
        "tinycloud.sql/write",
        "tinycloud.sql/schema",
        "tinycloud.sql/admin",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_SECRETS_SPACE),
      path: "vault/secrets/",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/del",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
    {
      service: "tinycloud.kv",
      space: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_SECRETS_SPACE),
      path: "variables/",
      actions: [
        "tinycloud.kv/get",
        "tinycloud.kv/put",
        "tinycloud.kv/del",
        "tinycloud.kv/list",
        "tinycloud.kv/metadata",
      ],
      skipPrefix: true,
    },
  ];

  for (let index = 0; index < grants.length; index += 1) {
    trace(`grant:${index}:${grants[index]!.service}:${grants[index]!.space}:${grants[index]!.path}`);
    await node.grantRuntimePermissions([grants[index]!]);
  }
}

async function seedSqlSpace(
  node: TinyCloudNode,
  spaceId: string,
  database: string,
  statements: Array<string | string[]>,
): Promise<void> {
  const sql = node.sqlForSpace(spaceId).db(database);
  const flattened = statements.flatMap((item) => (Array.isArray(item) ? item : [item]));
  trace(`sql:${spaceId}:${database}:statements=${flattened.length}`);
  for (const statement of flattened) {
    const result = await sql.execute(statement);
    ensureOk(result, `SQL seed in ${spaceId}/${database}`);
  }
}

async function ensureSqlColumn(
  node: TinyCloudNode,
  spaceId: string,
  database: string,
  table: string,
  column: string,
): Promise<void> {
  const sql = node.sqlForSpace(spaceId).db(database);
  trace(`sql:${spaceId}:${database}:${table}:pragma`);
  const info = await sql.query(`PRAGMA table_info(${table})`);
  ensureOk(info, `SQL schema check for ${spaceId}/${database}/${table}`);
  if (!info.data.rows.some((row) => String(row[1] ?? "") === column)) {
    if (info.data.rows.length === 0) {
      return;
    }
    trace(`sql:${spaceId}:${database}:${table}:alter ${column}`);
    const alter = await sql.execute(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    ensureOk(alter, `SQL column migration for ${spaceId}/${database}/${table}.${column}`);
  }
}

async function seedKvSpace(
  node: TinyCloudNode,
  spaceId: string,
  entries: Array<[string, unknown]>,
): Promise<void> {
  const kv = node.kvForSpace(spaceId);
  for (const [key, value] of entries) {
    trace(`kv:${spaceId}:${key}:put`);
    const result = await kv.put(key, value);
    ensureOk(result, `KV seed for ${spaceId}/${key}`);
  }
}

async function resetKvPrefix(
  node: TinyCloudNode,
  spaceId: string,
  prefix: string,
): Promise<void> {
  const kv = node.kvForSpace(spaceId);
  trace(`kv:${spaceId}:${prefix}:list`);
  const list = await kv.list({ prefix });
  ensureOk(list, `KV reset for ${spaceId}/${prefix}`);
  if (list.data.truncated) {
    throw new Error(`KV reset for ${spaceId}/${prefix} was truncated.`);
  }
  for (const key of new Set(list.data.keys)) {
    trace(`kv:${spaceId}:${key}:delete`);
    const result = await kv.delete(key);
    ensureOk(result, `KV cleanup for ${spaceId}/${key}`);
  }
}

async function seedVariables(node: TinyCloudNode, spaceId: string): Promise<void> {
  const kv = node.kvForSpace(spaceId);
  for (const name of REAL_FIXTURE_VARIABLE_NAMES) {
    const value = realFixtureVariableValue(name);
    const result = await kv.put(`variables/${name}`, {
      value,
      createdAt: new Date().toISOString(),
    });
    ensureOk(result, `variable seed for ${name}`);
  }
}

async function seedSecrets(
  cliDir: string,
  host: string,
  runSeed: string,
): Promise<Record<string, string>> {
  const network = await runTinyCloudCli(
    cliDir,
    host,
    ["secrets", "network", "init", REAL_FIXTURE_SECRETS_NETWORK],
  );
  if (network.exitCode !== 0) {
    throw new Error(`tc secrets network init failed: ${network.stderr || network.stdout}`);
  }

  const hashes: Record<string, string> = {};
  for (const name of REAL_FIXTURE_SECRET_NAMES) {
    const value = realFixtureSecretValue(name, runSeed);
    hashes[name] = sha256Hex(value);
    const result = await runTinyCloudCli(
      cliDir,
      host,
      ["secrets", "put", name, "--stdin"],
      value,
    );
    if (result.exitCode !== 0) {
      throw new Error(`tc secrets put ${name} failed: ${result.stderr || result.stdout}`);
    }
  }

  return hashes;
}

async function verifyCliSecret(
  cliDir: string,
  host: string,
  name: string,
  expectedHash: string,
): Promise<void> {
  const result = await runTinyCloudCli(cliDir, host, ["secrets", "get", name]);
  if (result.exitCode !== 0) {
    throw new Error(`tc secrets get ${name} failed: ${result.stderr || result.stdout}`);
  }
  const parsed = result.json as { value?: string } | null;
  const value = parsed?.value;
  if (typeof value !== "string") {
    throw new Error(`tc secrets get ${name} did not return a plaintext value.`);
  }
  const hash = sha256Hex(value);
  if (hash !== expectedHash) {
    throw new Error(`Secret hash mismatch for ${name}.`);
  }
}

function expectJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} did not return a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function queryRows<T extends Record<string, unknown>>(
  result: {
    data: {
      columns: string[];
      rows: unknown[][];
      rowCount: number;
    };
  },
): T[] {
  return result.data.rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (let index = 0; index < result.data.columns.length; index += 1) {
      record[result.data.columns[index]!] = row[index];
    }
    return record as T;
  });
}

async function assertKvEntries(
  node: TinyCloudNode,
  spaceId: string,
  prefix: string,
  expectedKeys: string[],
  label: string,
): Promise<void> {
  const list = await node.kvForSpace(spaceId).list({ prefix });
  ensureOk(list, `${label} KV verification`);
  if (list.data.truncated) {
    throw new Error(`${label} KV key list was truncated.`);
  }
  const actualKeys = [...new Set(list.data.keys)].sort();
  const expected = [...new Set(expectedKeys)].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} KV key set mismatch.\nactual=${pretty(actualKeys)}\nexpected=${pretty(expected)}`,
    );
  }
}

function assertRowSet<T extends Record<string, unknown>>(
  actual: T[],
  expected: T[],
  label: string,
): void {
  const sortKeys = Object.keys(expected[0] ?? {}).sort();
  const normalize = (row: T) =>
    JSON.stringify(Object.fromEntries(sortKeys.map((key) => [key, row[key]])));
  const normalizedActual = [...actual].sort((a, b) => normalize(a).localeCompare(normalize(b)));
  const normalizedExpected = [...expected].sort((a, b) => normalize(a).localeCompare(normalize(b)));
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(`${label} row set mismatch.\nactual=${pretty(normalizedActual)}\nexpected=${pretty(normalizedExpected)}`);
  }
}

async function seedFixture(stateFile: string, host: string, cliDir: string): Promise<SeedState> {
  trace("seed:version");
  const info = await fetch(`${host}/version`);
  if (!info.ok) {
    throw new Error(`Unable to reach TinyCloud host ${host}: HTTP ${info.status}`);
  }
  const version = (await info.json()) as { version?: string };
  if (!version.version) {
    throw new Error(`TinyCloud host ${host} did not return a version.`);
  }

  trace("seed:node-sdk");
  const workspaceRoot = workspaceRootFrom(import.meta.dir);
  const nodeSdkPackage = JSON.parse(
    await readFile(resolve(workspaceRoot, "repositories/js-sdk/packages/node-sdk/package.json"), "utf8"),
  ) as { version?: string };
  if (nodeSdkPackage.version !== EXPECTED_NODE_SDK_VERSION) {
    throw new Error(`Unexpected node-sdk version: ${nodeSdkPackage.version ?? "missing"}`);
  }

  trace("seed:create-node");
  const node = await createFixtureNode(host);
  const session = node.session;
  if (!session) {
    throw new Error("TinyCloud node sign-in did not create a session.");
  }
  if (session.chainId !== REAL_FIXTURE_CHAIN_ID) {
    throw new Error(`Unexpected chain id: ${session.chainId}`);
  }
  if (node.address?.toLowerCase() !== REAL_FIXTURE_ADDRESS.toLowerCase()) {
    throw new Error(`Unexpected fixture address: ${node.address ?? "missing"}`);
  }
  if (node.did !== REAL_FIXTURE_DID) {
    throw new Error(`Unexpected DID: ${node.did}`);
  }

  trace("seed:grant-runtime");
  await grantSeedRuntimePermissions(node);
  trace("seed:hosted-spaces");
  const spaces = await ensureHostedSpaces(node);
  trace("seed:cli-profile");
  await ensureCliProfile(cliDir, host);
  const publicSpaceId = spaces[REAL_FIXTURE_PUBLIC_SPACE];
  const applicationsSpaceId = spaces[REAL_FIXTURE_APPLICATIONS_SPACE];
  const accountSpaceId = spaces[REAL_FIXTURE_ACCOUNT_SPACE];
  const secretsSpaceId = spaces[REAL_FIXTURE_SECRETS_SPACE];
  const runSeed = randomUUID();

  trace("seed:reset-kv");
  await Promise.all([
    resetKvPrefix(node, publicSpaceId, "notes/"),
    resetKvPrefix(node, publicSpaceId, "projects/"),
    resetKvPrefix(node, applicationsSpaceId, "manifests/"),
    resetKvPrefix(node, applicationsSpaceId, "settings/"),
    resetKvPrefix(node, accountSpaceId, "spaces/"),
    resetKvPrefix(node, accountSpaceId, "delegations/"),
    resetKvPrefix(node, secretsSpaceId, "vault/secrets/"),
    resetKvPrefix(node, secretsSpaceId, "variables/"),
  ]);

  trace("seed:sql");
  await seedSqlSpace(
    node,
    publicSpaceId,
    REAL_FIXTURE_DEFAULT_SQL_DATABASE,
    [
      dbQuery("public_notes", [
        {
          id: "note-alpha",
          title: "Public alpha",
          body: `${REAL_FIXTURE_SQL_CANARY}-public`,
          canary: `${REAL_FIXTURE_SQL_CANARY}-public`,
        },
        {
          id: "note-beta",
          title: "Public beta",
          body: `${REAL_FIXTURE_SQL_CANARY}-public-2`,
          canary: `${REAL_FIXTURE_SQL_CANARY}-public-2`,
        },
      ], { reset: true }),
      dbQuery("public_projects", [
        {
          id: "project-alpha",
          name: "Explorer rollout",
          status: "ready",
          canary: `${REAL_FIXTURE_SQL_CANARY}-public-projects`,
        },
      ], { reset: true }),
    ],
  );

  await seedSqlSpace(
    node,
    applicationsSpaceId,
    REAL_FIXTURE_DEFAULT_SQL_DATABASE,
    [
      dbQuery("application_catalog", [
        {
          id: "app-explorer",
          app_id: REAL_FIXTURE_EXPLORER_APP_ID,
          label: `TinyCloud Explorer :: ${REAL_FIXTURE_SQL_CANARY}-applications`,
          canary: `${REAL_FIXTURE_SQL_CANARY}-applications`,
        },
        {
          id: "app-secret-manager",
          app_id: "xyz.tinycloud.secrets",
          label: `TinyCloud Secrets :: ${REAL_FIXTURE_SQL_CANARY}-applications-2`,
          canary: `${REAL_FIXTURE_SQL_CANARY}-applications-2`,
        },
      ], { reset: true }),
      dbQuery("application_settings", [
        {
          id: "theme",
          value: `${REAL_FIXTURE_SQL_CANARY}-applications-settings`,
          canary: `${REAL_FIXTURE_SQL_CANARY}-applications-settings`,
        },
      ], { reset: true }),
    ],
  );

  await seedSqlSpace(
    node,
    accountSpaceId,
    REAL_FIXTURE_ACCOUNT_SQL_DATABASE,
    [
      dbQuery("space_registry", [
        {
          id: "public",
          space_name: REAL_FIXTURE_PUBLIC_SPACE,
          kind: `owned::${REAL_FIXTURE_SQL_CANARY}-account`,
          canary: `${REAL_FIXTURE_SQL_CANARY}-account`,
        },
        {
          id: "applications",
          space_name: REAL_FIXTURE_APPLICATIONS_SPACE,
          kind: `owned::${REAL_FIXTURE_SQL_CANARY}-account-2`,
          canary: `${REAL_FIXTURE_SQL_CANARY}-account-2`,
        },
        {
          id: "secrets",
          space_name: REAL_FIXTURE_SECRETS_SPACE,
          kind: `owned::${REAL_FIXTURE_SQL_CANARY}-account-3`,
          canary: `${REAL_FIXTURE_SQL_CANARY}-account-3`,
        },
      ], { reset: true }),
      dbQuery("account_preferences", [
        {
          id: "layout",
          value: `${REAL_FIXTURE_SQL_CANARY}-account-preferences`,
          canary: `${REAL_FIXTURE_SQL_CANARY}-account-preferences`,
        },
      ], { reset: true }),
    ],
  );

  await seedSqlSpace(
    node,
    secretsSpaceId,
    REAL_FIXTURE_DEFAULT_SQL_DATABASE,
    [
      dbQuery("secret_catalog", [
        {
          id: REAL_FIXTURE_SECRET_NAMES[0],
          secret_name: REAL_FIXTURE_SECRET_NAMES[0],
          kind: `encrypted::secrets-catalog`,
          canary: "secrets-catalog",
        },
        {
          id: REAL_FIXTURE_SECRET_NAMES[1],
          secret_name: REAL_FIXTURE_SECRET_NAMES[1],
          kind: `encrypted::secrets-catalog-2`,
          canary: "secrets-catalog-2",
        },
      ], { reset: true }),
    ],
  );

  trace("seed:kv");
  await seedKvSpace(node, publicSpaceId, [
    ["notes/welcome.json", {
      canary: `${REAL_FIXTURE_KV_CANARY}-public-notes`,
      message: "welcome to the public space",
    }],
    ["projects/roadmap.json", {
      canary: `${REAL_FIXTURE_KV_CANARY}-public-projects`,
      message: "roadmap online",
    }],
  ]);

  await seedKvSpace(node, applicationsSpaceId, [
    ["manifests/explorer.json", {
      canary: `${REAL_FIXTURE_KV_CANARY}-applications-manifests`,
      appId: REAL_FIXTURE_EXPLORER_APP_ID,
    }],
    ["settings/runtime.json", {
      canary: `${REAL_FIXTURE_KV_CANARY}-applications-settings`,
      feature: "real-fixture",
    }],
  ]);

  await seedKvSpace(node, accountSpaceId, [
    ["spaces/public.json", {
      canary: `${REAL_FIXTURE_KV_CANARY}-account-spaces`,
      space: REAL_FIXTURE_PUBLIC_SPACE,
    }],
    ["delegations/current.json", {
      canary: `${REAL_FIXTURE_KV_CANARY}-account-delegations`,
      status: "active",
    }],
  ]);

  trace("seed:secrets");
  const secretHashes = await seedSecrets(cliDir, host, runSeed);
  if (preparedCliHome === undefined) {
    throw new Error("CLI home was not prepared.");
  }
  await writeFile(
    resolve(preparedCliHome, ".tinycloud/profiles", REAL_FIXTURE_CLI_PROFILE, "profile.json"),
    `${pretty({
      name: REAL_FIXTURE_CLI_PROFILE,
      host,
      chainId: REAL_FIXTURE_CHAIN_ID,
      spaceName: REAL_FIXTURE_SECRETS_SPACE,
      spaceId: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_SECRETS_SPACE),
      did: REAL_FIXTURE_DID,
      ownerDid: REAL_FIXTURE_DID,
      posture: "local-owner-key",
      operatorType: "human",
      authMethod: "local",
      privateKey: REAL_FIXTURE_PRIVATE_KEY,
      address: REAL_FIXTURE_ADDRESS,
      createdAt: new Date().toISOString(),
    })}\n`,
    "utf8",
  );
  const sessionPath = resolve(
    preparedCliHome,
    ".tinycloud/profiles",
    REAL_FIXTURE_CLI_PROFILE,
    "session.json",
  );
  if (existsSync(sessionPath)) {
    const session = JSON.parse(await readFile(sessionPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      sessionPath,
      `${pretty({
        ...session,
        spaceId: buildSpaceUri(REAL_FIXTURE_DID, REAL_FIXTURE_SECRETS_SPACE),
        spaceName: REAL_FIXTURE_SECRETS_SPACE,
      })}\n`,
      "utf8",
    );
  }
  trace("seed:variables");
  await seedVariables(node, secretsSpaceId);

  const state: SeedState = {
    version: 1,
    host,
    chainId: REAL_FIXTURE_CHAIN_ID,
    address: REAL_FIXTURE_ADDRESS,
    did: REAL_FIXTURE_DID,
    nodeSdkVersion: EXPECTED_NODE_SDK_VERSION,
    cliVersion: JSON.parse(
      await readFile(resolve(cliDir, "package.json"), "utf8"),
    ).version as string,
    runSeed,
    secretHashes,
  };

  await saveState(stateFile, state);
  return state;
}

async function verifyFixture(
  stateFile: string,
  host: string,
  cliDir: string,
): Promise<void> {
  trace("verify:state");
  const state = await loadState(stateFile);
  if (state.host !== host) {
    throw new Error(`Fixture state was seeded for ${state.host}, not ${host}.`);
  }
  if (state.nodeSdkVersion !== EXPECTED_NODE_SDK_VERSION) {
    throw new Error(`Fixture state was seeded for node-sdk ${state.nodeSdkVersion}.`);
  }
  const currentCliPackage = JSON.parse(
    await readFile(resolve(cliDir, "package.json"), "utf8"),
  ) as { version?: string };
  if (state.cliVersion !== currentCliPackage.version) {
    throw new Error(`Fixture state was seeded for CLI ${state.cliVersion}.`);
  }

  trace("verify:create-node");
  const node = await createFixtureNode(host);
  trace("verify:grant-runtime");
  await grantSeedRuntimePermissions(node);
  trace("verify:hosted-spaces");
  const spaces = await verifyHostedSpaces(node);
  if (spaces[REAL_FIXTURE_PUBLIC_SPACE] === undefined) {
    throw new Error("Public space was not hosted.");
  }
  if (spaces[REAL_FIXTURE_APPLICATIONS_SPACE] === undefined) {
    throw new Error("Applications space was not hosted.");
  }
  if (spaces[REAL_FIXTURE_ACCOUNT_SPACE] === undefined) {
    throw new Error("Account space was not hosted.");
  }
  if (spaces[REAL_FIXTURE_SECRETS_SPACE] === undefined) {
    throw new Error("Secrets space was not hosted.");
  }

  const publicSpaceId = spaces[REAL_FIXTURE_PUBLIC_SPACE];
  const applicationsSpaceId = spaces[REAL_FIXTURE_APPLICATIONS_SPACE];
  const accountSpaceId = spaces[REAL_FIXTURE_ACCOUNT_SPACE];
  const secretsSpaceId = spaces[REAL_FIXTURE_SECRETS_SPACE];
  trace("verify:cli-profile");
  await ensureCliProfile(cliDir, host);

  trace("verify:sql-public");
  const publicTables = await node.sqlForSpace(publicSpaceId).db(REAL_FIXTURE_DEFAULT_SQL_DATABASE).query(
    "SELECT id, title, body FROM public_notes ORDER BY id",
  );
  ensureOk(publicTables, "public/default SQL verification");
  if (publicTables.data.rowCount !== 2) {
    throw new Error("public/default SQL row count mismatch.");
  }
  assertRowSet(queryRows(publicTables), [
    {
      id: "note-alpha",
      title: "Public alpha",
      body: `${REAL_FIXTURE_SQL_CANARY}-public`,
    },
    {
      id: "note-beta",
      title: "Public beta",
      body: `${REAL_FIXTURE_SQL_CANARY}-public-2`,
    },
  ], "public/default SQL");
  trace("verify:kv-public");
  await assertKvEntries(
    node,
    publicSpaceId,
    "notes/",
    ["notes/welcome.json"],
    "public notes",
  );
  await assertKvEntries(
    node,
    publicSpaceId,
    "projects/",
    ["projects/roadmap.json"],
    "public projects",
  );
  const publicWelcome = await node.kvForSpace(publicSpaceId).get("notes/welcome.json");
  ensureOk(publicWelcome, "public notes KV verification");
  const publicWelcomeValue = expectJsonObject(publicWelcome.data.data, "public notes welcome");
  if (publicWelcomeValue.canary !== `${REAL_FIXTURE_KV_CANARY}-public-notes`) {
    throw new Error("Public welcome KV canary mismatch.");
  }
  const publicRoadmap = await node.kvForSpace(publicSpaceId).get("projects/roadmap.json");
  ensureOk(publicRoadmap, "public projects KV verification");
  const publicRoadmapValue = expectJsonObject(publicRoadmap.data.data, "public projects roadmap");
  if (publicRoadmapValue.canary !== `${REAL_FIXTURE_KV_CANARY}-public-projects`) {
    throw new Error("Public roadmap KV canary mismatch.");
  }

  trace("verify:sql-applications");
  const applicationsTables = await node.sqlForSpace(applicationsSpaceId).db(REAL_FIXTURE_DEFAULT_SQL_DATABASE).query(
    "SELECT id, app_id, label FROM application_catalog ORDER BY id",
  );
  ensureOk(applicationsTables, "applications/default SQL verification");
  if (applicationsTables.data.rowCount !== 2) {
    throw new Error("applications/default SQL row count mismatch.");
  }
  assertRowSet(queryRows(applicationsTables), [
    {
      id: "app-explorer",
      app_id: REAL_FIXTURE_EXPLORER_APP_ID,
      label: `TinyCloud Explorer :: ${REAL_FIXTURE_SQL_CANARY}-applications`,
    },
    {
      id: "app-secret-manager",
      app_id: "xyz.tinycloud.secrets",
      label: `TinyCloud Secrets :: ${REAL_FIXTURE_SQL_CANARY}-applications-2`,
    },
  ], "applications/default SQL");
  const applicationSettings = await node.sqlForSpace(applicationsSpaceId).db(REAL_FIXTURE_DEFAULT_SQL_DATABASE).query(
    "SELECT id, value FROM application_settings ORDER BY id",
  );
  ensureOk(applicationSettings, "applications/default settings verification");
  assertRowSet(queryRows(applicationSettings), [
    {
      id: "theme",
      value: `${REAL_FIXTURE_SQL_CANARY}-applications-settings`,
    },
  ], "applications/default settings");
  trace("verify:kv-applications");
  await assertKvEntries(
    node,
    applicationsSpaceId,
    "manifests/",
    ["manifests/explorer.json"],
    "applications manifests",
  );
  await assertKvEntries(
    node,
    applicationsSpaceId,
    "settings/",
    ["settings/runtime.json"],
    "applications settings",
  );
  const applicationsManifest = await node.kvForSpace(applicationsSpaceId).get("manifests/explorer.json");
  ensureOk(applicationsManifest, "applications manifests KV verification");
  const applicationsManifestValue = expectJsonObject(applicationsManifest.data.data, "applications manifests");
  if (applicationsManifestValue.canary !== `${REAL_FIXTURE_KV_CANARY}-applications-manifests`) {
    throw new Error("Applications manifest KV canary mismatch.");
  }
  const applicationsSettings = await node.kvForSpace(applicationsSpaceId).get("settings/runtime.json");
  ensureOk(applicationsSettings, "applications runtime KV verification");
  const applicationsSettingsValue = expectJsonObject(applicationsSettings.data.data, "applications settings");
  if (applicationsSettingsValue.canary !== `${REAL_FIXTURE_KV_CANARY}-applications-settings`) {
    throw new Error("Applications runtime KV canary mismatch.");
  }

  trace("verify:sql-account");
  const accountTables = await node.sqlForSpace(accountSpaceId).db(REAL_FIXTURE_ACCOUNT_SQL_DATABASE).query(
    "SELECT id, space_name, kind FROM space_registry ORDER BY id",
  );
  ensureOk(accountTables, "account/account SQL verification");
  if (accountTables.data.rowCount !== 3) {
    throw new Error("account/account SQL row count mismatch.");
  }
  assertRowSet(queryRows(accountTables), [
    {
      id: "applications",
      space_name: REAL_FIXTURE_APPLICATIONS_SPACE,
      kind: `owned::${REAL_FIXTURE_SQL_CANARY}-account-2`,
    },
    {
      id: "public",
      space_name: REAL_FIXTURE_PUBLIC_SPACE,
      kind: `owned::${REAL_FIXTURE_SQL_CANARY}-account`,
    },
    {
      id: "secrets",
      space_name: REAL_FIXTURE_SECRETS_SPACE,
      kind: `owned::${REAL_FIXTURE_SQL_CANARY}-account-3`,
    },
  ], "account/account SQL");
  const accountPreferences = await node.sqlForSpace(accountSpaceId).db(REAL_FIXTURE_ACCOUNT_SQL_DATABASE).query(
    "SELECT id, value FROM account_preferences ORDER BY id",
  );
  ensureOk(accountPreferences, "account/account preferences verification");
  assertRowSet(queryRows(accountPreferences), [
    {
      id: "layout",
      value: `${REAL_FIXTURE_SQL_CANARY}-account-preferences`,
    },
  ], "account/account preferences");
  trace("verify:kv-account");
  const accountSpaces = await node.kvForSpace(accountSpaceId).get("spaces/public.json");
  ensureOk(accountSpaces, "account spaces KV verification");
  const accountSpacesValue = expectJsonObject(accountSpaces.data.data, "account spaces");
  if (accountSpacesValue.canary !== `${REAL_FIXTURE_KV_CANARY}-account-spaces`) {
    throw new Error("Account spaces KV canary mismatch.");
  }
  const accountDelegations = await node.kvForSpace(accountSpaceId).get("delegations/current.json");
  ensureOk(accountDelegations, "account delegations KV verification");
  const accountDelegationsValue = expectJsonObject(accountDelegations.data.data, "account delegations");
  if (accountDelegationsValue.canary !== `${REAL_FIXTURE_KV_CANARY}-account-delegations`) {
    throw new Error("Account delegations KV canary mismatch.");
  }

  trace("verify:sql-secrets");
  const secretsTables = await node.sqlForSpace(secretsSpaceId).db(REAL_FIXTURE_DEFAULT_SQL_DATABASE).query(
    "SELECT id, secret_name, kind FROM secret_catalog ORDER BY id",
  );
  ensureOk(secretsTables, "secrets/default SQL verification");
  if (secretsTables.data.rowCount !== 2) {
    throw new Error("secrets/default SQL row count mismatch.");
  }
  assertRowSet(queryRows(secretsTables), [
    {
      id: REAL_FIXTURE_SECRET_NAMES[0],
      secret_name: REAL_FIXTURE_SECRET_NAMES[0],
      kind: "encrypted::secrets-catalog",
    },
    {
      id: REAL_FIXTURE_SECRET_NAMES[1],
      secret_name: REAL_FIXTURE_SECRET_NAMES[1],
      kind: "encrypted::secrets-catalog-2",
    },
  ], "secrets/default SQL");
  trace("verify:kv-secrets");
  await assertKvEntries(
    node,
    secretsSpaceId,
    "vault/secrets/",
    REAL_FIXTURE_SECRET_NAMES.map((name) => `vault/secrets/${name}`),
    "secrets vault",
  );
  await assertKvEntries(
    node,
    secretsSpaceId,
    "variables/",
    REAL_FIXTURE_VARIABLE_NAMES.map((name) => `variables/${name}`),
    "secrets variables",
  );

  trace("verify:variables");
  const variableFlags = await node.kvForSpace(secretsSpaceId).get(`variables/${REAL_FIXTURE_VARIABLE_NAMES[0]}`);
  ensureOk(variableFlags, "variables KV verification");
  const variableFlagsValue = expectJsonObject(variableFlags.data.data, "feature flag variable");
  if (variableFlagsValue.value !== realFixtureVariableValue(REAL_FIXTURE_VARIABLE_NAMES[0])) {
    throw new Error("Feature-flag variable value mismatch.");
  }
  const variableViewMode = await node.kvForSpace(secretsSpaceId).get(`variables/${REAL_FIXTURE_VARIABLE_NAMES[1]}`);
  ensureOk(variableViewMode, "variables KV verification");
  const variableViewModeValue = expectJsonObject(variableViewMode.data.data, "view-mode variable");
  if (variableViewModeValue.value !== realFixtureVariableValue(REAL_FIXTURE_VARIABLE_NAMES[1])) {
    throw new Error("View-mode variable value mismatch.");
  }

  trace("verify:secret-envelopes");
  for (const [name, expectedHash] of Object.entries(state.secretHashes)) {
    const entry = await node.kvForSpace(secretsSpaceId).get(`vault/secrets/${name}`, { raw: true });
    ensureOk(entry, `secret envelope verification for ${name}`);
    const raw = entry.data.data;
    if (typeof raw !== "string") {
      throw new Error(`Secret ${name} did not return a raw envelope string.`);
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed.v !== 1 ||
      typeof parsed.networkId !== "string" ||
      typeof parsed.alg !== "string" ||
      typeof parsed.keyVersion !== "number" ||
      typeof parsed.encryptedSymmetricKey !== "string" ||
      typeof parsed.encryptedSymmetricKeyHash !== "string" ||
      typeof parsed.ciphertext !== "string"
    ) {
      throw new Error(`Secret ${name} envelope is missing ciphertext metadata.`);
    }
    if (raw.includes(realFixtureSecretValue(name, state.runSeed))) {
      throw new Error(`Secret ${name} envelope leaked plaintext.`);
    }
    await verifyCliSecret(cliDir, host, name, expectedHash);
  }

  trace("verify:cli-secrets-list");
  const cliSecrets = await runTinyCloudCli(cliDir, host, ["secrets", "list"]);
  if (cliSecrets.exitCode !== 0) {
    throw new Error(`tc secrets list failed: ${cliSecrets.stderr || cliSecrets.stdout}`);
  }
  const cliSecretsJson = expectJsonObject(cliSecrets.json, "tc secrets list");
  const cliSecretNames = cliSecretsJson.secrets;
  const expectedSecretNames = [...REAL_FIXTURE_SECRET_NAMES].sort();
  const actualSecretNames = Array.isArray(cliSecretNames)
    ? [...new Set(cliSecretNames)].sort()
    : [];
  if (JSON.stringify(actualSecretNames) !== JSON.stringify(expectedSecretNames)) {
    throw new Error(`tc secrets list did not return the seeded secret names: ${pretty(cliSecretsJson)}`);
  }

  if (node.did !== REAL_FIXTURE_DID || node.address?.toLowerCase() !== REAL_FIXTURE_ADDRESS.toLowerCase()) {
    throw new Error("Fixture identity drifted.");
  }
}

async function main() {
  const command = process.argv[2];
  const workspaceRoot = workspaceRootFrom(import.meta.dir);
  const cliDir = await prepareCliWorkspace(workspaceRoot);
  const stateFile = resolve(workspaceRoot, DEFAULT_STATE_FILE);
  const hostFlagIndex = process.argv.indexOf("--host");
  const host =
    process.argv.find((arg) => arg.startsWith("--host="))?.slice("--host=".length) ??
    (hostFlagIndex >= 0 ? process.argv[hostFlagIndex + 1] : undefined) ??
    process.env.VITE_TINYCLOUD_HOST ??
    REAL_FIXTURE_HOST;

  if (command !== "seed" && command !== "verify") {
    throw new Error("Usage: bun scripts/real-fixture.ts <seed|verify> [--host=...]");
  }

  if (command === "seed") {
    const state = await seedFixture(stateFile, host, cliDir);
    console.log(pretty({ seeded: true, stateFile, host: state.host, address: state.address }));
    await verifyFixture(stateFile, host, cliDir);
    console.log(pretty({ verified: true, stateFile, host }));
    return;
  }

  await verifyFixture(stateFile, host, cliDir);
  console.log(pretty({ verified: true, stateFile, host }));
}

await main();
