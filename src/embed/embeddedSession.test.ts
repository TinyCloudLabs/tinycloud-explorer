import { describe, expect, it, vi } from "vitest";
import { OneEmbedSession, absoluteKv } from "./embeddedSession";
import {
  OWNER,
  OWNER_DID,
  grantOf,
  makeFakeFrame,
  makeKv,
  spaceOf,
} from "./embeddedTestKit";
import type { EmbedRequestResult } from "./oneEmbed";

describe("OneEmbedSession", () => {
  it("applies One's grant: owner from the delegation, one access per space, theme forwarded", async () => {
    const frame = makeFakeFrame();
    const onTheme = vi.fn();
    const session = new OneEmbedSession({ ...frame.config, onTheme });
    const started = session.start();
    await vi.waitFor(() => expect(frame.controller.start).toHaveBeenCalled());
    frame.grant(
      grantOf([
        { spaceId: spaceOf("applications"), actions: ["tinycloud.kv/get", "tinycloud.kv/put"] },
      ]),
    );
    await started;

    expect(session.owner).toEqual({ address: OWNER, chainId: 1, did: OWNER_DID });
    expect(session.grantedSpaceIds()).toEqual([spaceOf("applications")]);
    expect(session.accessFor(spaceOf("public"))).toBeUndefined();
    expect(session.actionsFor(spaceOf("applications"))).toEqual([
      "tinycloud.kv/get",
      "tinycloud.kv/put",
    ]);
    expect(onTheme).toHaveBeenCalledWith("dark");
  });

  it("ignores delegations from another owner, for spaces Explorer does not browse, or whose space disagrees", async () => {
    const frame = makeFakeFrame();
    const session = new OneEmbedSession(frame.config);
    const started = session.start();
    await vi.waitFor(() => expect(frame.controller.start).toHaveBeenCalled());
    const other = "0x2222222222222222222222222222222222222222";
    frame.tcw.useDelegation.mockImplementationOnce(async () => ({
      spaceId: spaceOf("public"),
      kv: makeKv(),
      sql: {},
    }) as never);
    frame.grant(
      grantOf([
        // useDelegation answers with the wrong space for this one
        { spaceId: spaceOf("secrets"), actions: ["tinycloud.kv/get"] },
        { spaceId: spaceOf("applications"), actions: ["tinycloud.kv/get"] },
        { spaceId: spaceOf("account"), actions: ["tinycloud.capabilities/read"] },
        { spaceId: spaceOf("public", other), actions: ["tinycloud.kv/get"] },
      ]),
    );
    await started;

    expect(session.grantedSpaceIds()).toEqual([spaceOf("applications")]);
    // The other-owner grant was never handed to the SDK.
    expect(frame.tcw.useDelegation).toHaveBeenCalledTimes(2);
  });

  it("times out when One stays silent, then retries hello with the same session key", async () => {
    const frame = makeFakeFrame();
    const timers: Array<() => void> = [];
    const session = new OneEmbedSession({
      ...frame.config,
      setTimer: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimer: () => undefined,
    });
    const first = session.start();
    const firstSettled = first.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    timers[0]();
    expect(await firstSettled).toMatchObject({ kind: "expired-session" });

    const second = session.start();
    await vi.waitFor(() => expect(frame.controller.repeatHello).toHaveBeenCalledTimes(1));
    frame.grant(grantOf([{ spaceId: spaceOf("applications"), actions: ["tinycloud.kv/get"] }]));
    await second;
    expect(frame.controller.start).toHaveBeenCalledTimes(1);
    expect(session.grantedSpaceIds()).toEqual([spaceOf("applications")]);
  });

  it("rejects the first connect when One denies", async () => {
    const frame = makeFakeFrame();
    const session = new OneEmbedSession(frame.config);
    const started = session.start();
    const settled = started.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(frame.controller.start).toHaveBeenCalled());
    frame.denied();
    expect(await settled).toMatchObject({ kind: "denied-capability" });
  });

  it("applies a requested grant before request() resolves", async () => {
    const frame = makeFakeFrame();
    const session = new OneEmbedSession(frame.config);
    const started = session.start();
    await vi.waitFor(() => expect(frame.controller.start).toHaveBeenCalled());
    frame.grant(grantOf([{ spaceId: spaceOf("applications"), actions: ["tinycloud.kv/get"] }]));
    await started;

    frame.controller.request.mockImplementationOnce(async () => {
      const grant = grantOf([{ spaceId: spaceOf("public"), actions: ["tinycloud.kv/list"] }]);
      frame.grant(grant);
      return { kind: "grant", grant } as EmbedRequestResult;
    });
    const permissions = [
      { service: "tinycloud.kv", space: spaceOf("public"), path: "", actions: ["tinycloud.kv/list"] },
    ];
    const result = await session.request(permissions as never);

    expect(result.kind).toBe("grant");
    expect(frame.controller.request).toHaveBeenCalledWith(permissions);
    expect(session.accessFor(spaceOf("public"))).toBeDefined();
    expect(session.accessFor(spaceOf("applications"))).toBeDefined();
  });

  it("drops every delegation and the key on revoke", async () => {
    const frame = makeFakeFrame();
    const onRevoked = vi.fn();
    const session = new OneEmbedSession({ ...frame.config, onRevoked });
    const started = session.start();
    await vi.waitFor(() => expect(frame.controller.start).toHaveBeenCalled());
    frame.grant(grantOf([{ spaceId: spaceOf("applications"), actions: ["tinycloud.kv/get"] }]));
    await started;

    frame.revoke();
    expect(onRevoked).toHaveBeenCalledTimes(1);
    expect(session.grantedSpaceIds()).toEqual([]);
    expect(session.owner).toBeNull();
    expect(() => session.tcw).toThrow();
  });
});

describe("absoluteKv", () => {
  it("sends absolute keys with an empty prefix and leaves list prefixes alone", async () => {
    const kv = makeKv();
    const wrapped = absoluteKv(kv as never);

    await wrapped.get("vault/secrets/a", { raw: true });
    await wrapped.put("app-state/x", { a: 1 });
    await wrapped.delete("app-state/x");
    await wrapped.list({ prefix: "app-state/", limit: 5 });

    expect(kv.get).toHaveBeenCalledWith("vault/secrets/a", { raw: true, prefix: "" });
    expect(kv.put).toHaveBeenCalledWith("app-state/x", { a: 1 }, { prefix: "" });
    expect(kv.delete).toHaveBeenCalledWith("app-state/x", { prefix: "" });
    expect(kv.list).toHaveBeenCalledWith({ prefix: "app-state/", limit: 5 });
  });
});
