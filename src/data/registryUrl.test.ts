// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as WebSdk from "@tinycloud/web-sdk";
import { DEFAULT_TINYCLOUD_LOCATION_REGISTRY_URL, lookupOwnerRegistryVerdict } from "@tinycloud/sdk-core";

// A sign-in for an owner whose registry record does not exist (the registry answers 404).
// SDK 3.12+ looks the owner up before signing; a null registry URL makes that lookup throw for everyone.

const sdk = vi.hoisted(() => ({ configs: [] as Array<Record<string, any>> }));

vi.mock("@tinycloud/web-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof WebSdk>();
  return {
    ...actual,
    TinyCloudWeb: vi.fn(function (this: unknown, config: Record<string, any>) {
      sdk.configs.push(config);
      return { signIn: async () => undefined, cleanup: () => undefined };
    }),
  };
});

beforeEach(() => {
  sdk.configs.length = 0;
  globalThis.HTMLElement ??= class HTMLElement {} as typeof HTMLElement;
  globalThis.customElements ??= { define() {}, get: () => undefined } as unknown as typeof customElements;
});
afterEach(() => vi.restoreAllMocks());

const OWNER = "did:pkh:eip155:1:0xdADEEA221d064B18E48c2009f29a0839170a53A4";
const notFound = vi.fn(async () => new Response(JSON.stringify({ error: "location record not found" }), { status: 404, headers: { "content-type": "application/json" } }));

describe("the registry the Explorer sign-in asks about an owner", () => {
  it("is a real registry, and the SDK's owner lookup for a no-record owner finds nobody instead of failing", async () => {
    const { RealExplorerDataSource } = await import("./realExplorerDataSource");
    const source = new RealExplorerDataSource({
      openKeyHost: "https://openkey.so",
      tinycloudHost: "https://node.tinycloud.xyz",
      createOpenKey: () => ({ authorizeTinyCloud: vi.fn() }) as never,
      connectOpenKey: async () => ({ address: "0xdADEEA221d064B18E48c2009f29a0839170a53A4", keyId: "k", keyType: "EXTERNAL" as const }),
      sessionStorage: { activeAddress: () => undefined },
    });
    await source.connect().catch(() => undefined);

    const config = sdk.configs[0];
    expect(config.tinycloudRegistryUrl).toBe(DEFAULT_TINYCLOUD_LOCATION_REGISTRY_URL);

    const verdict = await lookupOwnerRegistryVerdict(OWNER, { registryUrl: config.tinycloudRegistryUrl, fetch: notFound as never });
    expect(verdict.status).toBe("unregistered");
    expect(notFound).toHaveBeenCalled();
  });

  it("is what the lookup refuses to run without", async () => {
    await expect(lookupOwnerRegistryVerdict(OWNER, { registryUrl: null, fetch: notFound as never })).rejects.toThrow(/no location registry is configured/);
  });
});
