export const REAL_FIXTURE_HOST = "https://node.tinycloud.xyz";
export const REAL_FIXTURE_CHAIN_ID = 1;
export const REAL_FIXTURE_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const REAL_FIXTURE_ADDRESS =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const REAL_FIXTURE_DID =
  `did:pkh:eip155:${REAL_FIXTURE_CHAIN_ID}:${REAL_FIXTURE_ADDRESS}`;
export const REAL_FIXTURE_PUBLIC_SPACE = "public";
export const REAL_FIXTURE_APPLICATIONS_SPACE = "applications";
export const REAL_FIXTURE_ACCOUNT_SPACE = "account";
export const REAL_FIXTURE_SECRETS_SPACE = "secrets";
export const REAL_FIXTURE_DEFAULT_SQL_DATABASE = "default";
export const REAL_FIXTURE_ACCOUNT_SQL_DATABASE = "account";
export const REAL_FIXTURE_SECRETS_NETWORK = "default";
export const REAL_FIXTURE_EXPLORER_APP_ID = "xyz.tinycloud.explorer";
export const REAL_FIXTURE_SQL_CANARY = "tinycloud-explorer-canary";
export const REAL_FIXTURE_KV_CANARY = "tinycloud-explorer-canary";
export const REAL_FIXTURE_SECRET_NAMES = [
  "EXPLORER_ALPHA_SECRET",
  "EXPLORER_BRAVO_SECRET",
] as const;
export const REAL_FIXTURE_VARIABLE_NAMES = [
  "EXPLORER_FEATURE_FLAG",
  "EXPLORER_VIEW_MODE",
] as const;

export function realFixtureOwnerDid(address = REAL_FIXTURE_ADDRESS): string {
  return `did:pkh:eip155:${REAL_FIXTURE_CHAIN_ID}:${address}`;
}

export function realFixtureEncryptionNetworkId(
  ownerDid = REAL_FIXTURE_DID,
  name = REAL_FIXTURE_SECRETS_NETWORK,
): string {
  return `urn:tinycloud:encryption:${ownerDid}:${name}`;
}

export function realFixtureSecretValue(name: string, runSeed: string): string {
  return `${name.toLowerCase()}-${runSeed}`;
}

export function realFixtureVariableValue(name: string): string {
  return `${name.toLowerCase().replaceAll("_", "-")}-value`;
}

