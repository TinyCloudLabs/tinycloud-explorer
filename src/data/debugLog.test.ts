import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearExplorerLogs,
  explorerLog,
  getExplorerLogs,
  httpStatusFrom,
  installExplorerHttpLogging,
  subscribeExplorerLogs,
} from "./debugLog";

describe("Explorer debug log", () => {
  beforeEach(() => {
    clearExplorerLogs();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("redacts authentication material and stored values", () => {
    explorerLog("info", "auth", "Connected", {
      address: "0x1234",
      authorization: "Bearer live-token",
      note: "request failed with Bearer abcdefghij.klmnopqrst.uvwxyz12345",
      nested: {
        signature: "0xsigned",
        value: { private: true },
      },
    });

    expect(getExplorerLogs()[0]).toMatchObject({
      scope: "auth",
      details: {
        address: "0x1234",
        authorization: "[redacted]",
        note: "request failed with Bearer [redacted]",
        nested: {
          signature: "[redacted]",
          value: "[redacted]",
        },
      },
    });
  });

  it("publishes updates and clears the current session log", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeExplorerLogs(listener);
    explorerLog("info", "spaces", "Discovered", { count: 4 });
    clearExplorerLogs();
    unsubscribe();

    expect(listener).toHaveBeenLastCalledWith([]);
  });

  it("records HTTP start, stop, status, and elapsed timing without query strings", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("unavailable", { status: 503 }),
    );
    const restore = installExplorerHttpLogging(["https://node.tinycloud.xyz"]);

    try {
      await fetch("https://node.tinycloud.xyz/invoke?authorization=sensitive", {
        method: "POST",
      });
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }

    const [started, stopped] = getExplorerLogs();
    expect(started).toMatchObject({
      level: "debug",
      scope: "http",
      message: "POST /invoke started",
      details: {
        method: "POST",
        url: "https://node.tinycloud.xyz/invoke",
        phase: "start",
      },
    });
    expect(stopped).toMatchObject({
      level: "error",
      scope: "http",
      details: {
        method: "POST",
        url: "https://node.tinycloud.xyz/invoke",
        phase: "stop",
        outcome: "error",
        httpStatus: 503,
      },
    });
    expect(stopped?.details?.elapsedMs).toEqual(expect.any(Number));
    expect(stopped?.details?.startedAt).toEqual(expect.any(String));
    expect(stopped?.details?.stoppedAt).toEqual(expect.any(String));
  });

  it("extracts HTTP status from SDK error shapes and messages", () => {
    expect(httpStatusFrom({ response: { status: 401 } })).toBe(401);
    expect(
      httpStatusFrom({
        message: "Failed to list keys: 500 - invocation replay storage unavailable",
      }),
    ).toBe(500);
  });
});
