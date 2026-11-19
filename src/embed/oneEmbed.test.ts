import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOneEmbedController,
  isOneOrigin,
  ONE_ORIGINS,
  randomNonce,
  REGRANT_LEAD_MS,
  resolveOneParentOrigin,
  type EmbedGrant,
} from "./oneEmbed";

const PARENT = "https://localhost:5186";
const SPACE = "tinycloud:pkh:eip155:1:0xabc:applications";

const PRODUCTION = ["https://tinycloud.one"];
const PREVIEW = [...PRODUCTION, "https://feat-one-apps.tinychat.pages.dev"];
const DEV = [...PRODUCTION, "https://localhost:5186"];

describe("isOneOrigin", () => {
  it("production list accepts only tinycloud.one", () => {
    expect(isOneOrigin("https://tinycloud.one", PRODUCTION)).toBe(true);
    expect(isOneOrigin("https://feat-one-apps.tinychat.pages.dev", PRODUCTION)).toBe(false);
    expect(isOneOrigin("https://localhost:5186", PRODUCTION)).toBe(false);
  });

  it("preview and dev lists add their one origin each", () => {
    expect(isOneOrigin("https://feat-one-apps.tinychat.pages.dev", PREVIEW)).toBe(true);
    expect(isOneOrigin("https://localhost:5186", PREVIEW)).toBe(false);
    expect(isOneOrigin("https://localhost:5186", DEV)).toBe(true);
    expect(isOneOrigin("https://feat-one-apps.tinychat.pages.dev", DEV)).toBe(false);
  });

  it("this test build (DEV) trusts tinycloud.one and https://localhost:5186", () => {
    expect(ONE_ORIGINS).toEqual(DEV);
  });

  it.each([
    "http://tinycloud.one",
    "https://tinycloud.one.evil.test",
    "https://evil.test",
    "http://localhost:5186",
    "https://localhost:5187",
    "https://other.tinychat.pages.dev",
    "https://tinychat.pages.dev",
    "https://a.feat-one-apps.tinychat.pages.dev",
    "https://tinychat.pages.dev.evil.test",
    "https://evil.test/https://tinycloud.one",
    "*",
    "null",
    "",
  ])("rejects %s in every list", (origin) => {
    for (const list of [PRODUCTION, PREVIEW, DEV]) {
      expect(isOneOrigin(origin, list)).toBe(false);
    }
  });
});

describe("resolveOneParentOrigin", () => {
  const ok = {
    isFramed: true,
    search: "?embed=one",
    referrer: "https://tinycloud.one/chat/apps",
  };

  it("returns the referrer origin when framed with embed=one", () => {
    expect(resolveOneParentOrigin(ok)).toBe("https://tinycloud.one");
  });

  it("is off when not framed, flag missing or wrong, or referrer foreign/empty", () => {
    expect(resolveOneParentOrigin({ ...ok, isFramed: false })).toBeNull();
    expect(resolveOneParentOrigin({ ...ok, search: "" })).toBeNull();
    expect(resolveOneParentOrigin({ ...ok, search: "?embed=other" })).toBeNull();
    expect(resolveOneParentOrigin({ ...ok, referrer: "https://evil.test/" })).toBeNull();
    expect(resolveOneParentOrigin({ ...ok, referrer: "" })).toBeNull();
    expect(resolveOneParentOrigin({ ...ok, referrer: "not a url" })).toBeNull();
  });
});

describe("randomNonce", () => {
  it("is 16 random bytes as unpadded base64url", () => {
    const nonce = randomNonce((bytes) => bytes.fill(0xfb));
    expect(nonce).toBe("-_v7-_v7-_v7-_v7-_v7-w");
    expect(randomNonce()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

interface Harness {
  win: Window;
  parent: { postMessage: ReturnType<typeof vi.fn> };
  deliver: (init: { data: unknown; origin?: string; source?: unknown }) => void;
}

function harness(): Harness {
  const parent = { postMessage: vi.fn() };
  const listeners = new Set<(event: MessageEvent) => void>();
  const win = {
    parent,
    addEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: MessageEvent) => void) =>
      listeners.delete(fn),
  } as unknown as Window;
  return {
    win,
    parent,
    deliver: ({ data, origin = PARENT, source = parent }) => {
      for (const fn of [...listeners]) {
        fn({ data, origin, source } as unknown as MessageEvent);
      }
    },
  };
}

function grantMessage(nonce: string, overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    type: "tc-embed/grant",
    nonce,
    grants: [{ spaceId: SPACE, delegation: { cid: "bafy-1" }, cid: "bafy-1" }],
    expiresAt: 1767229200000,
    theme: "dark",
    ...overrides,
  };
}

describe("createOneEmbedController", () => {
  let h: Harness;
  let nonces: string[];
  let onGrant: ReturnType<typeof vi.fn<(grant: EmbedGrant) => void>>;
  let onRevoke: ReturnType<typeof vi.fn<() => void>>;
  let onTheme: ReturnType<typeof vi.fn<(theme: "light" | "dark") => void>>;
  let onDenied: ReturnType<typeof vi.fn<() => void>>;
  let controller: ReturnType<typeof createOneEmbedController>;

  beforeEach(() => {
    h = harness();
    nonces = ["n1", "n2", "n3", "n4"];
    onGrant = vi.fn();
    onRevoke = vi.fn();
    onTheme = vi.fn();
    onDenied = vi.fn();
    controller = createOneEmbedController({
      win: h.win,
      parentOrigin: PARENT,
      appId: "xyz.tinycloud.explorer",
      sessionDid: "did:key:z6MkTest",
      onGrant,
      onRevoke,
      onTheme,
      onDenied,
      nonce: () => nonces.shift()!,
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    });
  });

  afterEach(() => controller.stop());

  it("sends hello to the parent origin only, with the session DID and nonce", () => {
    controller.start();
    expect(h.parent.postMessage).toHaveBeenCalledTimes(1);
    expect(h.parent.postMessage).toHaveBeenCalledWith(
      {
        v: 1,
        type: "tc-embed/hello",
        appId: "xyz.tinycloud.explorer",
        sessionDid: "did:key:z6MkTest",
        nonce: "n1",
      },
      PARENT,
    );
  });

  it("refuses a non-One parent origin", () => {
    expect(() =>
      createOneEmbedController({
        win: h.win,
        parentOrigin: "https://evil.test",
        appId: "x",
        sessionDid: "did:key:z6Mk",
        onGrant,
        onRevoke,
      }),
    ).toThrow();
  });

  it("never posts with targetOrigin '*': hello, repeat hello and request all name the parent origin", () => {
    controller.start();
    void controller.request([]);
    expect(h.parent.postMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of h.parent.postMessage.mock.calls) {
      expect(call[1]).toBe(PARENT);
    }
  });

  it("refuses '*' and an http One origin as parent origin", () => {
    for (const parentOrigin of ["*", "http://localhost:5186"]) {
      expect(() =>
        createOneEmbedController({
          win: h.win,
          parentOrigin,
          appId: "x",
          sessionDid: "did:key:z6Mk",
          onGrant,
          onRevoke,
        }),
      ).toThrow();
    }
  });

  it("applies a grant carrying the latest nonce", () => {
    controller.start();
    h.deliver({ data: grantMessage("n1") });
    expect(onGrant).toHaveBeenCalledTimes(1);
    expect(onGrant.mock.calls[0][0]).toMatchObject({
      grants: [{ spaceId: SPACE, cid: "bafy-1" }],
      expiresAt: 1767229200000,
      theme: "dark",
    });
  });

  it("ignores messages from a foreign origin", () => {
    controller.start();
    h.deliver({ data: grantMessage("n1"), origin: "https://evil.test" });
    h.deliver({ data: { v: 1, type: "tc-embed/revoke" }, origin: "https://evil.test" });
    h.deliver({ data: { v: 1, type: "tc-embed/theme", theme: "dark" }, origin: "https://evil.test" });
    expect(onGrant).not.toHaveBeenCalled();
    expect(onRevoke).not.toHaveBeenCalled();
    expect(onTheme).not.toHaveBeenCalled();
  });

  it("ignores a One origin that is not the referrer-derived parent origin", () => {
    controller.start();
    h.deliver({ data: grantMessage("n1"), origin: "https://tinycloud.one" });
    expect(onGrant).not.toHaveBeenCalled();
  });

  it("ignores messages whose source is not window.parent", () => {
    controller.start();
    h.deliver({ data: grantMessage("n1"), source: { postMessage: vi.fn() } });
    h.deliver({ data: { v: 1, type: "tc-embed/revoke" }, source: null });
    expect(onGrant).not.toHaveBeenCalled();
    expect(onRevoke).not.toHaveBeenCalled();
  });

  it("drops a grant with a stale or unknown nonce", () => {
    controller.start();
    void controller.request([]);
    h.deliver({ data: grantMessage("n1") });
    h.deliver({ data: grantMessage("other") });
    expect(onGrant).not.toHaveBeenCalled();
    h.deliver({ data: grantMessage("n2") });
    expect(onGrant).toHaveBeenCalledTimes(1);
  });

  it("drops malformed and wrong-version messages", () => {
    controller.start();
    h.deliver({ data: grantMessage("n1", { v: 2 }) });
    h.deliver({ data: grantMessage("n1", { grants: [{ spaceId: "s", delegation: "nope", cid: "c" }] }) });
    h.deliver({ data: grantMessage("n1", { grants: "nope" }) });
    h.deliver({ data: grantMessage("n1", { expiresAt: "2026-01-01T01:00:00.000Z" }) });
    h.deliver({ data: grantMessage("n1", { expiresAt: 1767229200 }) });
    h.deliver({ data: grantMessage("n1", { theme: "sepia" }) });
    h.deliver({ data: "tc-embed/grant" });
    expect(onGrant).not.toHaveBeenCalled();
  });

  it("revoke clears state: later grants for the old nonce are dropped and pending requests settle", async () => {
    controller.start();
    const pending = controller.request([
      { service: "tinycloud.kv", space: "s", path: "", actions: ["tinycloud.kv/get"] },
    ]);
    h.deliver({ data: { v: 1, type: "tc-embed/revoke" } });
    await expect(pending).resolves.toEqual({ kind: "revoked" });
    expect(onRevoke).toHaveBeenCalledTimes(1);
    h.deliver({ data: grantMessage("n2") });
    expect(onGrant).not.toHaveBeenCalled();
  });

  it("resolves a request with the grant or with denied", async () => {
    controller.start();
    const permissions = [
      { service: "tinycloud.kv", space: "s", path: "", actions: ["tinycloud.kv/get"] },
    ];
    const first = controller.request(permissions);
    expect(h.parent.postMessage).toHaveBeenLastCalledWith(
      { v: 1, type: "tc-embed/request", nonce: "n2", permissions },
      PARENT,
    );
    h.deliver({
      data: grantMessage("n2", {
        grants: [{ spaceId: SPACE, delegation: { cid: "bafy-2" }, cid: "bafy-2" }],
      }),
    });
    await expect(first).resolves.toMatchObject({
      kind: "grant",
      grant: { grants: [{ cid: "bafy-2" }] },
    });

    const second = controller.request(permissions);
    h.deliver({ data: { v: 1, type: "tc-embed/denied", nonce: "n2" } });
    expect(onDenied).not.toHaveBeenCalled();
    h.deliver({ data: { v: 1, type: "tc-embed/denied", nonce: "n3" } });
    await expect(second).resolves.toEqual({ kind: "denied" });
  });

  it("forwards theme messages from the parent", () => {
    controller.start();
    h.deliver({ data: { v: 1, type: "tc-embed/theme", theme: "light" } });
    expect(onTheme).toHaveBeenCalledWith("light");
  });

  it("stop() detaches the listener", () => {
    controller.start();
    controller.stop();
    h.deliver({ data: grantMessage("n1") });
    expect(onGrant).not.toHaveBeenCalled();
  });

  describe("re-grant", () => {
    it("re-sends hello ahead of expiry with a fresh nonce", () => {
      const timers: { fn: () => void; ms: number }[] = [];
      const c = createOneEmbedController({
        win: h.win,
        parentOrigin: PARENT,
        appId: "xyz.tinycloud.explorer",
        sessionDid: "did:key:z6MkTest",
        onGrant,
        onRevoke,
        nonce: () => nonces.shift()!,
        now: () => Date.parse("2026-01-01T00:00:00.000Z"),
        setTimer: (fn, ms) => timers.push({ fn, ms }),
        clearTimer: () => {},
      });
      c.start();
      h.deliver({ data: grantMessage("n1") });
      expect(timers).toHaveLength(1);
      expect(timers[0].ms).toBe(60 * 60 * 1000 - REGRANT_LEAD_MS);
      timers[0].fn();
      expect(h.parent.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "tc-embed/hello", nonce: "n2" }),
        PARENT,
      );
      h.deliver({ data: grantMessage("n1") });
      expect(onGrant).toHaveBeenCalledTimes(1);
      c.stop();
    });
  });
});
