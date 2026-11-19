import { describe, expect, it, vi } from "vitest";
import { OneEmbedSession } from "../embed/embeddedSession";
import {
  OWNER,
  OWNER_DID,
  grantOf,
  makeFakeFrame,
  makeKv,
  spaceOf,
} from "../embed/embeddedTestKit";
import type { EmbedRequestResult } from "../embed/oneEmbed";

function ensureBrowserGlobals() {
  if (typeof globalThis.HTMLElement === "undefined") {
    globalThis.HTMLElement = class HTMLElement {} as typeof HTMLElement;
  }
  if (typeof globalThis.customElements === "undefined") {
    globalThis.customElements = {
      define() {},
      get() {
        return undefined;
      },
    } as unknown as typeof customElements;
  }
}

const READ_WRITE_KV = ["tinycloud.kv/get", "tinycloud.kv/list", "tinycloud.kv/put", "tinycloud.kv/del"];

function kvWith(entries: Record<string, unknown>) {
  const kv = makeKv();
  kv.list.mockImplementation((async (options?: { prefix?: string }) => ({
    ok: true,
    data: {
      keys: Object.keys(entries).filter((key) => key.startsWith(options?.prefix ?? "")),
      truncated: false,
    },
  })) as never);
  kv.get.mockImplementation((async (key: string) => ({
    ok: true,
    data: {
      data: entries[key],
      headers: {
        contentType: "application/json",
        contentLength: 2,
        etag: '"blake3-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
        lastModified: "2026-07-26T12:00:00Z",
      },
    },
  })) as never);
  return kv;
}

async function makeEmbeddedSource() {
  ensureBrowserGlobals();
  const { RealExplorerDataSource } = await import("./realExplorerDataSource");
  const frame = makeFakeFrame();
  const applications = spaceOf("applications");
  const appEntries: Record<string, unknown> = { "manifests/explorer.json": { id: "explorer" } };
  const appKv = kvWith(appEntries);
  appKv.put.mockImplementation((async (key: string, value: unknown) => {
    appEntries[key] = value;
    return { ok: true, data: { data: undefined, headers: {} } };
  }) as never);
  frame.kvBySpace.set(applications, appKv);
  const onRevoked = vi.fn();
  const onTheme = vi.fn();
  const source = new RealExplorerDataSource({
    openKeyHost: "https://openkey.so",
    tinycloudHost: "https://node.tinycloud.xyz",
    spacePrefix: "applications",
    // No OpenKey seams: the embedded path must never reach for a wallet.
    createOpenKey: () => {
      throw new Error("OpenKey must not be used when embedded");
    },
    embedded: {
      parentOrigin: "https://tinycloud.one",
      onRevoked,
      onTheme,
      createSession: (config) => new OneEmbedSession({ ...config, ...frame.config }),
    },
  });
  const connecting = source.connect();
  await vi.waitFor(() => expect(frame.controller.start).toHaveBeenCalled());
  frame.grant(grantOf([{ spaceId: applications, actions: READ_WRITE_KV }]));
  const snapshot = await connecting;
  return { source, snapshot, frame, appKv, applications, onRevoked, onTheme };
}

describe("RealExplorerDataSource embedded in One", () => {
  it("opens from the silent applications grant alone: no wallet, owner from the delegation, other spaces need permission", async () => {
    const { snapshot, appKv, frame, onTheme } = await makeEmbeddedSource();

    expect(snapshot.identity).toMatchObject({
      address: OWNER,
      did: OWNER_DID,
      sessionDid: frame.tcw.sessionDid,
    });
    const byName = Object.fromEntries(snapshot.spaces.map((space) => [space.name, space]));
    expect(Object.keys(byName).sort()).toEqual(["applications", "public", "secrets"]);
    expect(byName.applications.access).toBe("read-write");
    expect(byName.public.access).toBe("needs-permission");
    // Not delegated, so never opened: only the placeholder sql row is shown.
    expect(byName.secrets.resources.map((resource) => resource.kind)).toEqual(["sql"]);
    expect(frame.kvBySpace.has(spaceOf("secrets"))).toBe(false);

    const kvResource = byName.applications.resources.find((resource) => resource.kind === "kv");
    expect(kvResource?.kind === "kv" && kvResource.entries.map((entry) => entry.key)).toContain(
      "manifests/explorer.json",
    );
    // Absolute keys, empty delegation prefix.
    expect(appKv.get).toHaveBeenCalledWith("manifests/explorer.json", expect.objectContaining({ prefix: "" }));
    // Only the granted space was ever opened with useDelegation.
    expect(frame.tcw.useDelegation).toHaveBeenCalledTimes(1);
    expect(onTheme).toHaveBeenCalledWith("dark");
  });

  it("writes with absolute keys through the delegated kv", async () => {
    const { source, appKv, applications } = await makeEmbeddedSource();

    await source.writeKvEntry(applications, "__space__", "manifests/new.json", { a: 1 });

    expect(appKv.put).toHaveBeenCalledWith("manifests/new.json", { a: 1 }, { prefix: "" });
  });

  it("asks One for a missing space and browses it once granted", async () => {
    const { source, frame, snapshot } = await makeEmbeddedSource();
    const publicId = spaceOf("public");
    const publicKv = kvWith({ "notes/hello.md": "hi" });
    frame.kvBySpace.set(publicId, publicKv);
    frame.controller.request.mockImplementationOnce(async () => {
      const grant = grantOf([
        { spaceId: publicId, actions: ["tinycloud.kv/get", "tinycloud.kv/list", "tinycloud.kv/metadata"] },
      ]);
      frame.grant(grant);
      return { kind: "grant", grant } as EmbedRequestResult;
    });

    const granted = await source.grantSpacePermissions(
      snapshot.spaces.find((space) => space.name === "public")!.id,
    );

    const [permissions] = frame.controller.request.mock.calls[0] as unknown as [
      Array<{ space: string }>,
    ];
    expect(permissions.length).toBeGreaterThan(0);
    expect(permissions.every((entry) => entry.space === publicId)).toBe(true);
    expect(granted.access).not.toBe("needs-permission");
    expect(publicKv.list).toHaveBeenCalled();
  });

  it("reports a denied request with the existing denied-capability failure", async () => {
    const { source, snapshot } = await makeEmbeddedSource();

    await expect(
      source.grantSpacePermissions(snapshot.spaces.find((space) => space.name === "secrets")!.id),
    ).rejects.toMatchObject({ kind: "denied-capability" });
  });

  it("tells the app when One revokes and drops the session on disconnect", async () => {
    const { source, frame, onRevoked } = await makeEmbeddedSource();

    frame.revoke();
    expect(onRevoked).toHaveBeenCalledTimes(1);
    await source.disconnect();
    expect(frame.controller.stop).toHaveBeenCalled();
  });
});
